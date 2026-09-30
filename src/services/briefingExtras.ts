/**
 * Consultas dos blocos extras do briefing matinal. Cada uma é isolada: se
 * uma falhar (tabela ausente, etc.), o bloco dela fica vazio e o resto segue.
 * Render em `briefingExtrasRender.ts`.
 */
import { db } from '../config/database';
import type { BriefingExtras } from './briefingExtrasRender';

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

export async function getBriefingExtras(): Promise<BriefingExtras> {
  // Conversas (7 dias) cuja última mensagem é do contato, sem resposta há 2h+.
  const whatsappAguardando = await safe(async () => {
    const [rows] = await db.query(`
      SELECT t.phone, COALESCE(cl.name, m.push_name, t.phone) AS nome,
             TIMESTAMPDIFF(HOUR, t.ultima_in, UTC_TIMESTAMP()) AS horas
        FROM (SELECT phone,
                     MAX(CASE WHEN from_me = 0 THEN msg_time END) AS ultima_in,
                     MAX(CASE WHEN from_me = 1 THEN msg_time END) AS ultima_out
                FROM whatsapp_messages
               WHERE msg_time > UTC_TIMESTAMP() - INTERVAL 7 DAY
               GROUP BY phone) t
        LEFT JOIN whatsapp_chat_meta m ON m.phone = t.phone
        LEFT JOIN clients cl ON cl.id = (SELECT client_id FROM whatsapp_messages x WHERE x.phone = t.phone AND x.client_id IS NOT NULL LIMIT 1)
       WHERE t.ultima_in IS NOT NULL
         AND (t.ultima_out IS NULL OR t.ultima_out < t.ultima_in)
         AND t.ultima_in < UTC_TIMESTAMP() - INTERVAL 2 HOUR
         AND COALESCE(m.archived, 0) = 0 AND COALESCE(m.blocked, 0) = 0
       ORDER BY t.ultima_in ASC LIMIT 20`) as any;
    return rows.map((r: any) => ({ nome: String(r.nome), horas: Number(r.horas) }));
  }, []);

  const docsRecebidos = await safe(async () => {
    const [[r]] = await db.query('SELECT COUNT(*) AS n FROM whatsapp_media WHERE created_at > UTC_TIMESTAMP() - INTERVAL 24 HOUR') as any;
    return Number(r?.n) || 0;
  }, 0);

  const naoAnalisadas = await safe(async () => {
    const [rows] = await db.query(`
      SELECT DISTINCT lp.process_number FROM process_movements pm JOIN legal_processes lp ON lp.id = pm.process_id
       WHERE pm.created_at > UTC_TIMESTAMP() - INTERVAL 24 HOUR AND pm.ai_summary IS NULL LIMIT 20`) as any;
    return rows.map((r: any) => r.process_number);
  }, []);

  const falhasConsulta = await safe(async () => {
    const [rows] = await db.query(`
      SELECT DISTINCT lp.process_number FROM monitoring_logs ml JOIN legal_processes lp ON lp.id = ml.process_id
       WHERE ml.executed_at > UTC_TIMESTAMP() - INTERVAL 24 HOUR AND ml.status = 'erro'
         AND NOT EXISTS (SELECT 1 FROM monitoring_logs ok WHERE ok.process_id = ml.process_id
                          AND ok.status <> 'erro' AND ok.executed_at > ml.executed_at)
       LIMIT 20`) as any;
    return rows.map((r: any) => r.process_number);
  }, []);

  const parcelasAtrasadas = await safe(async () => {
    const [[a]] = await db.query(`SELECT COUNT(*) AS qtd, COALESCE(SUM(valor),0) AS total FROM installments
                                   WHERE status IN ('pendente','vencido') AND due_date < CURDATE()`) as any;
    const [[b]] = await db.query(`SELECT COUNT(*) AS qtd, COALESCE(SUM(COALESCE(valor_final, valor)),0) AS total FROM parcelas
                                   WHERE status IN ('aberto','vencido') AND data_vencimento < CURDATE()`) as any;
    return { qtd: Number(a.qtd) + Number(b.qtd), total: Number(a.total) + Number(b.total) };
  }, { qtd: 0, total: 0 });

  const repassesCliente = await safe(async () => {
    const [[r]] = await db.query(`SELECT COUNT(*) AS qtd, COALESCE(SUM(valor_liquido),0) AS total FROM agreement_client_payouts
                                   WHERE status = 'pendente' AND (data_prevista IS NULL OR data_prevista <= CURDATE() + INTERVAL 3 DAY)`) as any;
    return { qtd: Number(r.qtd), total: Number(r.total) };
  }, { qtd: 0, total: 0 });

  const leadsSemResposta24h = await safe(async () => {
    const [rows] = await db.query(`SELECT name FROM leads
       WHERE first_response_at IS NULL AND created_at < UTC_TIMESTAMP() - INTERVAL 24 HOUR
         AND created_at > UTC_TIMESTAMP() - INTERVAL 30 DAY
         AND status NOT IN ('perdida','fechada','convertido','contrato_assinado')
       ORDER BY created_at LIMIT 10`) as any;
    return rows.map((r: any) => r.name || 'Lead sem nome');
  }, []);

  const saude = await safe(async () => {
    const [erros] = await db.query(`
      SELECT DISTINCT j.job FROM job_runs j
       WHERE j.status = 'erro' AND j.ran_at > UTC_TIMESTAMP() - INTERVAL 24 HOUR
         AND NOT EXISTS (SELECT 1 FROM job_runs k WHERE k.job = j.job AND k.status = 'ok' AND k.ran_at > j.ran_at)`) as any;
    const [[bk]] = await db.query(`SELECT COUNT(*) AS n FROM job_runs WHERE job = 'backup:diario' AND status = 'ok'
                                    AND ran_at > UTC_TIMESTAMP() - INTERVAL 26 HOUR`) as any;
    return { rotinasComErro: erros.map((r: any) => r.job), backupOk: Number(bk.n) > 0 };
  }, { rotinasComErro: [], backupOk: true });

  return { whatsappAguardando, docsRecebidos, naoAnalisadas, falhasConsulta, parcelasAtrasadas, repassesCliente, leadsSemResposta24h, saude };
}
