import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { montarItens, montarSaude, tudoOk, type DadosHoje } from '../services/hojeRegras';

/**
 * GET /api/hoje — tudo que precisa da advogada hoje, numa lista só, mais o
 * painel de saúde. Cada consulta é isolada: se uma falhar, o resto aparece.
 */
const router = Router();

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}
const local = (col: string) => `DATE(CONVERT_TZ(${col},'+00:00','-03:00'))`;
const HOJE = "DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))";

router.get('/', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { getBriefingExtras } = await import('../services/briefingExtras');
  const extras = await safe(() => getBriefingExtras(), null as any);

  const mut = await safe(async () => {
    const [rows] = await db.query("SELECT d.start_date, d.created_at, d.suggested_days FROM detected_deadlines d WHERE d.status = 'a_confirmar'") as any;
    const { contarPrazo } = await import('../utils/prazoUtil');
    const { classificar } = await import('../services/mutiraoPrazos');
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    let urgentes = 0;
    for (const r of rows) {
      const ini = new Date(r.start_date || r.created_at).toISOString().slice(0, 10);
      if (classificar(String(contarPrazo(ini, Number(r.suggested_days) || 15).vencimento).slice(0, 10), hoje) === 'urgente') urgentes++;
    }
    return { total: rows.length, urgentes };
  }, { total: 0, urgentes: 0 });

  const prazosHoje = await safe(async () => {
    const [r] = await db.query(
      `SELECT d.description, c.case_number FROM deadlines d LEFT JOIN cases c ON c.id = d.case_id
        WHERE d.status = 'pendente' AND ${local('d.deadline_date')} = ${HOJE}`) as any;
    return r.map((x: any) => `${x.description}${x.case_number ? ` — ${x.case_number}` : ''}`);
  }, [] as string[]);

  const audienciasHoje = await safe(async () => {
    const [r] = await db.query(
      `SELECT title, start_datetime FROM calendar_events
        WHERE event_type = 'audiencia' AND sync_status <> 'cancelado' AND ${local('start_datetime')} = ${HOJE} ORDER BY start_datetime`) as any;
    return r.map((x: any) => `${new Date(x.start_datetime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })} ${x.title}`);
  }, [] as string[]);

  const conta = (sql: string, params: any[] = []) => safe(async () => {
    const [[r]] = await db.query(sql, params) as any; return Number(r?.n) || 0;
  }, 0);

  const [acordos, propAbertas, propSemAbrir, duplicados, tarefas] = await Promise.all([
    conta("SELECT COUNT(DISTINCT REGEXP_REPLACE(lp.process_number,'[^0-9]','')) n FROM acordos_detectados ad JOIN legal_processes lp ON lp.id = ad.process_id WHERE ad.status = 'pendente'"),
    conta("SELECT COUNT(*) n FROM propostas WHERE status IN ('enviada','em_negociacao')"),
    conta("SELECT COUNT(*) n FROM propostas WHERE status IN ('enviada','em_negociacao') AND visualizada_em IS NULL"),
    conta("SELECT COUNT(*) n FROM (SELECT REGEXP_REPLACE(process_number,'[^0-9]','') d FROM legal_processes GROUP BY d HAVING COUNT(*) > 1) x"),
    conta(`SELECT COUNT(*) n FROM tasks WHERE status IN ('pendente','em_andamento') AND due_date < NOW()
             AND (detected_deadline_id IS NULL OR detected_deadline_id NOT IN (SELECT id FROM detected_deadlines WHERE status = 'a_confirmar'))`),
  ]);
  const clientesAConferir = await safe(async () => (await (await import('../services/revisaoClientesProcessos')).listarParaRevisao()).length, 0);

  const dados: DadosHoje = {
    prazosUrgentes: mut.urgentes, prazosAConfirmar: mut.total, prazosHoje, audienciasHoje,
    whatsappAguardando: extras?.whatsappAguardando || [], acordosARegistrar: acordos,
    propostasAbertas: propAbertas, propostasSemAbrir: propSemAbrir,
    leadsSemResposta: (extras?.leadsSemResposta24h || []).length,
    parcelasAtrasadas: extras?.parcelasAtrasadas || { qtd: 0, total: 0 },
    repassesCliente: extras?.repassesCliente || { qtd: 0, total: 0 },
    clientesAConferir, processosDuplicados: duplicados, tarefasVencidas: tarefas,
  };

  // ── Saúde ──
  const whatsapp = await safe(async () => (await (await import('../services/uazapiInstance')).getStatus()).connected, null as boolean | null);
  const googleAgenda = await safe(async () => {
    const [[g]] = await db.query('SELECT id FROM google_accounts WHERE user_id = ? AND sync_enabled = 1', [userId]) as any;
    if (!g) return null;
    const { googleCalendarService } = await import('../services/GoogleCalendarService');
    try { await googleCalendarService.checarConexao(userId); return true; } catch { return false; }
  }, null as boolean | null);
  const { conexaoExpirada } = await import('../services/conexaoGoogle');
  const gmailParceria = await safe(async () => {
    const [[r]] = await db.query('SELECT refresh_token FROM email_integration WHERE id = 1') as any;
    return r?.refresh_token ? !(await conexaoExpirada('parceria:sync-gmail')) : null;
  }, null as boolean | null);
  const gmailTribunal = await safe(async () => {
    const [[r]] = await db.query('SELECT refresh_token FROM court_email_integration WHERE id = 1') as any;
    return r?.refresh_token ? !(await conexaoExpirada('monitoramento:processos-email')) : null;
  }, null as boolean | null);
  const backupOk = await conta("SELECT COUNT(*) n FROM job_runs WHERE job = 'backup:diario' AND status = 'ok' AND ran_at > UTC_TIMESTAMP() - INTERVAL 26 HOUR").then((n) => n > 0);
  const tribunaisOk = await conta("SELECT COUNT(*) n FROM job_runs WHERE job = 'monitoramento:processos' AND status = 'ok' AND ran_at > UTC_TIMESTAMP() - INTERVAL 8 HOUR").then((n) => n > 0);

  const saude = montarSaude({ whatsapp, googleAgenda, gmailParceria, gmailTribunal, backupOk, tribunaisOk });
  res.json({ itens: montarItens(dados), saude, tudoOk: tudoOk(saude) });
});

export default router;
