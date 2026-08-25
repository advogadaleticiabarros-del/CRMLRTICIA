import { Router, Request, Response } from 'express';
import { db } from '../../config/database';
import { CANAIS } from '../../services/leadChannel';

// Etapas ativas do funil (espelha FUNNEL_ORDER do frontend, public/app.js:3841).
// Não inclui os 4 status de desfecho do ENUM de leads.status — esses são
// resultados finais (virou cliente, foi perdido, ou é assinante de
// newsletter que nunca entra no funil de triagem), não etapas do funil.
const ETAPAS_FUNIL = [
  'triagem', 'atendimento_inicial', 'reuniao',
  'documentacao_pendente', 'proposta', 'proposta_em_analise', 'contrato_assinado',
];

export function calcularFunilConversao(leadsPorStatus: { status: string; total: number }[]) {
  const porStatus: Record<string, number> = {};
  for (const row of leadsPorStatus) porStatus[row.status] = row.total;

  const etapas = ETAPAS_FUNIL.map((status, i) => {
    const volume = porStatus[status] || 0;
    if (i === 0) return { status, volume, taxa_conversao: null as number | null };
    const volumeAnterior = porStatus[ETAPAS_FUNIL[i - 1]] || 0;
    const taxa = volumeAnterior === 0 ? null : Math.round((volume / volumeAnterior) * 1000) / 10;
    return { status, volume, taxa_conversao: taxa };
  });

  const desfechos = {
    fechados: (porStatus['fechada'] || 0) + (porStatus['convertido'] || 0),
    perdidos: porStatus['perdida'] || 0,
    newsletter: porStatus['newsletter'] || 0,
  };

  return { etapas, desfechos };
}

export function calcularRentabilidadeArea(
  linhas: { legal_area: string; total_casos: number; receita_total: number }[]
) {
  return linhas.map((l) => {
    // installments.valor é DECIMAL e o pool não usa decimalNumbers:true, então
    // o mysql2 devolve SUM(i.valor) como string em runtime (ex: "8000.00").
    // Normaliza pra number de verdade antes de calcular e retornar.
    const receita_total = Number(l.receita_total) || 0;
    return {
      legal_area: l.legal_area,
      total_casos: l.total_casos,
      receita_total,
      receita_media_caso: l.total_casos > 0 ? Math.round((receita_total / l.total_casos) * 100) / 100 : 0,
    };
  });
}

export function calcularCustoAquisicao(
  gastos: { canal: string; valor: number }[],
  clientesPorCanal: { canal: string; total: number }[]
) {
  const gastoPorCanal: Record<string, number> = {};
  for (const g of gastos) gastoPorCanal[g.canal] = Number(g.valor) || 0;

  const clientesPorCanalMap: Record<string, number> = {};
  for (const c of clientesPorCanal) clientesPorCanalMap[c.canal] = c.total;

  const canaisEnvolvidos = new Set([...Object.keys(gastoPorCanal), ...Object.keys(clientesPorCanalMap)]);

  return Array.from(canaisEnvolvidos).map((canal) => {
    const gasto = gastoPorCanal[canal] || 0;
    const clientes = clientesPorCanalMap[canal] || 0;
    const custo_por_cliente = clientes > 0 ? Math.round((gasto / clientes) * 100) / 100 : null;
    return { canal, gasto, clientes, custo_por_cliente };
  });
}

const router = Router();

// GET /api/dashboards/comercial
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    const [[metrics]] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM leads WHERE user_id = ? AND DATE(created_at) = CURDATE())                             AS leads_hoje,
        (SELECT COUNT(*) FROM leads WHERE user_id = ?)                                                              AS leads_total,
        (SELECT COUNT(*) FROM propostas WHERE user_id = ? AND status = 'enviada')                                   AS propostas_enviadas,
        (SELECT COUNT(*) FROM propostas WHERE user_id = ? AND status = 'aceita')                                    AS propostas_aceitas,
        (SELECT COUNT(*) FROM propostas WHERE user_id = ? AND status IN ('enviada','aceita')) AS total_propostas_analisaveis,
        (SELECT COALESCE(SUM(valor), 0) FROM propostas WHERE user_id = ? AND status = 'enviada')                    AS valor_potencial_aberto,
        (SELECT COUNT(*) FROM calendar_events WHERE user_id = ? AND event_type = 'reuniao' AND start_datetime >= NOW()) AS reunioes_marcadas,
        (SELECT COUNT(*) FROM propostas WHERE user_id = ? AND status = 'enviada' AND DATE(validade) BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)) AS propostas_vencendo
    `, Array(8).fill(userId)) as any;

    const [leadsPorStatus] = await db.query(
      'SELECT status, COUNT(*) AS total FROM leads WHERE user_id = ? GROUP BY status ORDER BY total DESC',
      [userId]
    ) as any;
    const funil_conversao = calcularFunilConversao(leadsPorStatus);

    const [rentabilidadeRows] = await db.query(`
      SELECT c.legal_area, COUNT(DISTINCT c.id) AS total_casos, COALESCE(SUM(i.valor), 0) AS receita_total
      FROM cases c
      LEFT JOIN installments i ON i.case_id = c.id AND i.status = 'pago'
      WHERE c.user_id = ? AND c.legal_area IS NOT NULL
      GROUP BY c.legal_area
      ORDER BY receita_total DESC
    `, [userId]) as any;
    const rentabilidade_area = calcularRentabilidadeArea(rentabilidadeRows);

    const [porOrigem] = await db.query(
      "SELECT COALESCE(NULLIF(source,''),'(sem origem)') AS origem, COUNT(*) AS total FROM leads WHERE user_id = ? GROUP BY origem ORDER BY total DESC",
      [userId]
    ) as any;

    const [porArea] = await db.query(
      "SELECT COALESCE(NULLIF(legal_area,''),'(indefinida)') AS area, COUNT(*) AS total FROM leads WHERE user_id = ? GROUP BY area ORDER BY total DESC",
      [userId]
    ) as any;

    // Só campanhas de fato (utm_campaign preenchido) — orgânico/direto não tem campanha pra medir.
    const [porCampanha] = await db.query(
      `SELECT utm_campaign AS campanha, COALESCE(NULLIF(source,''),'(sem origem)') AS origem, COUNT(*) AS total,
              SUM(CASE WHEN status IN ('fechada','convertido') THEN 1 ELSE 0 END) AS convertidos
         FROM leads WHERE user_id = ? AND utm_campaign IS NOT NULL AND utm_campaign <> ''
        GROUP BY utm_campaign, origem ORDER BY total DESC LIMIT 20`,
      [userId]
    ) as any;

    const [[fin]] = await db.query(`
      SELECT
        (SELECT COALESCE(SUM(valor),0) FROM propostas WHERE user_id = ? AND status = 'enviada')                AS receita_prevista,
        (SELECT COALESCE(SUM(valor),0) FROM propostas WHERE user_id = ? AND status = 'aceita')                 AS receita_fechada,
        (SELECT COALESCE(AVG(valor),0) FROM propostas WHERE user_id = ? AND status = 'aceita' AND valor > 0)   AS ticket_medio,
        (SELECT COALESCE(SUM(estimated_value),0) FROM leads WHERE user_id = ? AND estimated_value IS NOT NULL
           AND status NOT IN ('fechada','convertido','perdida'))                                               AS pipeline_estimado
    `, Array(4).fill(userId)) as any;

    const taxa_conversao = metrics.total_propostas_analisaveis > 0
      ? ((metrics.propostas_aceitas / metrics.total_propostas_analisaveis) * 100).toFixed(1)
      : '0.0';

    res.json({
      leads_hoje:          metrics.leads_hoje,
      leads_total:         metrics.leads_total,
      leads_por_status:    leadsPorStatus,
      funil_conversao,
      rentabilidade_area,
      por_origem:          porOrigem,
      por_area:            porArea,
      por_campanha:        porCampanha,
      propostas_enviadas:  metrics.propostas_enviadas,
      propostas_aceitas:   metrics.propostas_aceitas,
      taxa_conversao:      `${taxa_conversao}%`,
      valor_potencial_aberto: metrics.valor_potencial_aberto,
      receita_prevista:    fin.receita_prevista,
      receita_fechada:     fin.receita_fechada,
      ticket_medio:        fin.ticket_medio,
      pipeline_estimado:   fin.pipeline_estimado,
      reunioes_marcadas:   metrics.reunioes_marcadas,
      propostas_vencendo:  metrics.propostas_vencendo,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar dashboard comercial' });
  }
});

// POST /api/dashboards/comercial/gasto-marketing — lança/atualiza o gasto de um mês+canal
router.post('/gasto-marketing', async (req: Request, res: Response) => {
  try {
    const { mes_referencia, canal, valor } = req.body || {};
    if (!mes_referencia || !CANAIS.includes(canal)) {
      res.status(400).json({ error: 'Informe mês e um canal válido' });
      return;
    }
    const valorNum = Number(valor);
    if (!Number.isFinite(valorNum) || valorNum < 0) {
      res.status(400).json({ error: 'Informe um valor válido' });
      return;
    }
    const userId = (req as any).user.id;
    await db.query(
      `INSERT INTO gasto_marketing (mes_referencia, canal, valor, created_by)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE valor = VALUES(valor), created_by = VALUES(created_by)`,
      [mes_referencia, canal, valorNum, userId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao lançar gasto de marketing' });
  }
});

// GET /api/dashboards/comercial/gasto-marketing?mes=YYYY-MM — lançamentos do mês
router.get('/gasto-marketing', async (req: Request, res: Response) => {
  try {
    const mes = String(req.query.mes || '');
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      res.status(400).json({ error: 'Informe o mês no formato YYYY-MM' });
      return;
    }
    const [rows] = await db.query(
      `SELECT canal, valor FROM gasto_marketing WHERE DATE_FORMAT(mes_referencia, '%Y-%m') = ?`,
      [mes]
    ) as any;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar gasto de marketing' });
  }
});

// GET /api/dashboards/comercial/custo-aquisicao?mes=YYYY-MM — custo por cliente adquirido, por canal
router.get('/custo-aquisicao', async (req: Request, res: Response) => {
  try {
    const mes = String(req.query.mes || '');
    if (!/^\d{4}-\d{2}$/.test(mes)) {
      res.status(400).json({ error: 'Informe o mês no formato YYYY-MM' });
      return;
    }
    const userId = (req as any).user.id;

    const [gastos] = await db.query(
      `SELECT canal, valor FROM gasto_marketing WHERE DATE_FORMAT(mes_referencia, '%Y-%m') = ?`,
      [mes]
    ) as any;

    const [clientesPorCanal] = await db.query(
      `SELECT COALESCE(NULLIF(source,''),'Outro') AS canal, COUNT(*) AS total
         FROM leads
        WHERE user_id = ? AND status IN ('fechada','convertido') AND DATE_FORMAT(updated_at, '%Y-%m') = ?
        GROUP BY canal`,
      [userId, mes]
    ) as any;

    res.json(calcularCustoAquisicao(gastos, clientesPorCanal));
  } catch (err) {
    res.status(500).json({ error: 'Erro ao calcular custo de aquisição' });
  }
});

export default router;
