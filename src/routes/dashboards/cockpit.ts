import { Router, Request, Response } from 'express';
import { db } from '../../config/database';

const router = Router();

/** Roda uma query e devolve um fallback se a tabela/coluna ainda não existir (ex.: migration não aplicada). */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// ── GET /api/dashboards/cockpit — painel-mãe do escritório ───────────────────
// Agrega os itens ACIONÁVEIS de cada área num só lugar: dinheiro, prazos
// críticos, intimações a confirmar, alertas, agenda do dia e pendências.
router.get('/', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;

  // Financeiro — a receber (hoje/7d), a pagar (7d), inadimplência (vencido)
  const financeiro = await safe(async () => {
    const [[fr]] = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo='receita' AND status='pendente' AND due_date <= CURDATE() THEN valor END),0) AS receber_hoje,
        COALESCE(SUM(CASE WHEN tipo='receita' AND status='pendente' AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN valor END),0) AS receber_7d,
        COALESCE(SUM(CASE WHEN tipo='despesa' AND status='pendente' AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN valor END),0) AS pagar_7d,
        COALESCE(SUM(CASE WHEN tipo='receita' AND status='vencido' THEN valor END),0) AS vencido
      FROM financial_records WHERE user_id = ?`, [userId]) as any;
    const [[inst]] = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status='pendente' AND due_date <= CURDATE() THEN valor END),0) AS receber_hoje,
        COALESCE(SUM(CASE WHEN status='pendente' AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN valor END),0) AS receber_7d,
        COALESCE(SUM(CASE WHEN status='pendente' AND due_date < CURDATE() THEN valor END),0) AS vencido
      FROM installments WHERE user_id = ?`, [userId]) as any;
    const [[aud]] = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status IN ('agendada','realizada','faturada') AND due_date <= CURDATE() THEN value END),0) AS receber_hoje,
        COALESCE(SUM(CASE WHEN status IN ('agendada','realizada','faturada') AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN value END),0) AS receber_7d,
        COALESCE(SUM(CASE WHEN status IN ('agendada','realizada','faturada') AND due_date < CURDATE() THEN value END),0) AS vencido
      FROM correspondent_hearings WHERE user_id = ?`, [userId]) as any;
    return {
      receber_hoje: Number(fr.receber_hoje) + Number(inst.receber_hoje) + Number(aud.receber_hoje),
      receber_7d:   Number(fr.receber_7d)   + Number(inst.receber_7d)   + Number(aud.receber_7d),
      pagar_7d:     Number(fr.pagar_7d),
      vencido:      Number(fr.vencido)      + Number(inst.vencido)      + Number(aud.vencido),
    };
  }, { receber_hoje: 0, receber_7d: 0, pagar_7d: 0, vencido: 0 });

  // Prazos críticos — pendentes vencidos ou nas próximas 72h
  const prazos = await safe(async () => {
    const [rows] = await db.query(`
      SELECT d.id, d.description, d.deadline_date, c.case_number,
             cl.name AS client_name,
             TIMESTAMPDIFF(DAY, NOW(), d.deadline_date) AS days_remaining,
             (d.deadline_date < NOW()) AS vencido
        FROM deadlines d
        LEFT JOIN cases c    ON c.id  = d.case_id
        LEFT JOIN clients cl ON cl.id = d.client_id
       WHERE d.user_id = ? AND d.status = 'pendente'
         AND d.deadline_date <= DATE_ADD(NOW(), INTERVAL 3 DAY)
       ORDER BY d.deadline_date ASC LIMIT 15`, [userId]) as any;
    return rows;
  }, [] as any[]);

  // Intimações a confirmar (detector DJEN) — com a análise do estagiário
  const intimacoes = await safe(async () => {
    const [rows] = await db.query(`
      SELECT d.id, COALESCE(c.name, cp.name) AS client_name, d.suggested_type,
             d.suggested_days, d.start_date, lp.process_number,
             (d.ai_draft_id IS NOT NULL) AS tem_minuta
        FROM detected_deadlines d
        LEFT JOIN legal_processes lp ON lp.id = d.process_id
        LEFT JOIN clients c  ON c.id  = d.client_id
        LEFT JOIN clients cp ON cp.id = lp.client_id
       -- ANTES havia um filtro por lp.user_id. A tabela legal_processes NAO TEM
       -- a coluna user_id: o MySQL lancava erro, o safe() engolia e esta secao
       -- ficava SEMPRE VAZIA. Intimacao nova nunca aparecia no Cockpit — risco
       -- direto de PRAZO PERDIDO. Os processos sao do escritorio, nao de um
       -- usuario: nao ha o que filtrar.
       WHERE d.status = 'a_confirmar'
       ORDER BY d.start_date DESC LIMIT 10`) as any;
    return rows;
  }, [] as any[]);

  // Alertas de movimentação sem intimação (salvaguarda DataJud)
  const alertas = await safe(async () => {
    const [rows] = await db.query(`
      SELECT ma.id, ma.title, ma.detected_keyword, lp.process_number
        FROM movement_alerts ma
        LEFT JOIN legal_processes lp ON lp.id = ma.process_id
       -- Mesmo bug: legal_processes não tem user_id. A salvaguarda do DataJud
       -- (movimentação sem intimação) ficava sempre vazia.
       WHERE ma.status = 'aberto'
       ORDER BY ma.created_at DESC LIMIT 10`) as any;
    return rows;
  }, [] as any[]);

  // Agenda de hoje (reuniões/audiências/compromissos — excluindo canceladas)
  const agenda_hoje = await safe(async () => {
    const [rows] = await db.query(`
      SELECT ce.id, ce.title, ce.event_type, ce.start_datetime, cl.name AS client_name
        FROM calendar_events ce
        LEFT JOIN clients cl ON cl.id = ce.client_id
       WHERE ce.user_id = ? AND DATE(ce.start_datetime) = CURDATE() AND ce.sync_status NOT IN ('cancelado','erro')
       ORDER BY ce.start_datetime ASC`, [userId]) as any;
    return rows;
  }, [] as any[]);

  // Contadores de pendências
  const [tarefas_pendentes, propostas_paradas] = await Promise.all([
    safe(async () => {
      const [[r]] = await db.query(
        "SELECT COUNT(*) total FROM tasks WHERE user_id = ? AND status NOT IN ('concluida','cancelada')", [userId]
      ) as any;
      return Number(r.total);
    }, 0),
    safe(async () => {
      const [[r]] = await db.query(
        "SELECT COUNT(*) total FROM leads WHERE user_id = ? AND status = 'proposta_em_analise'", [userId]
      ) as any;
      return Number(r.total);
    }, 0),
  ]);

  // Produção — total a protocolar (na esteira, antes do protocolo) e protocolados no mês
  const producao = await safe(async () => {
    const [[ap]] = await db.query(`
      SELECT COUNT(*) AS total FROM cases
       WHERE production_stage IN ('em_analise','separacao_documentos','criacao_inicial','revisao_inicial','aguardando_protocolo')`) as any;
    const [[pm]] = await db.query(`
      SELECT COUNT(DISTINCT case_id) AS total FROM client_timeline
       WHERE event_type = 'etapa_protocolado'
         AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`) as any;
    return { a_protocolar: Number(ap.total) || 0, protocolados_mes: Number(pm.total) || 0 };
  }, { a_protocolar: 0, protocolados_mes: 0 });

  res.json({
    financeiro,
    prazos,
    intimacoes: { count: intimacoes.length, itens: intimacoes },
    alertas: { count: alertas.length, itens: alertas },
    agenda_hoje,
    tarefas_pendentes,
    propostas_paradas,
    producao,
  });
});

export default router;
