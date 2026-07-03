import { db } from '../config/database';

// Métricas do cockpit fotografadas 1x/dia (âmbito do escritório, não por usuário).
const KEYS = [
  'receber_hoje', 'receber_7d', 'pagar_7d', 'inadimplencia', 'tarefas_pendentes', 'propostas_analise',
  'receita_prevista', 'receita_realizada', 'despesa_prevista', 'despesa_paga', 'saldo_previsto', 'saldo_realizado',
] as const;

/** Calcula os valores de hoje e grava (upsert) na data de Brasília. Retorna quantas métricas gravou. */
export async function captureDailyMetrics(): Promise<number> {
  const [[fr]] = await db.query(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo='receita' AND status='pendente' AND due_date <= CURDATE() THEN valor END),0) AS receber_hoje,
      COALESCE(SUM(CASE WHEN tipo='receita' AND status='pendente' AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN valor END),0) AS receber_7d,
      COALESCE(SUM(CASE WHEN tipo='despesa' AND status='pendente' AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN valor END),0) AS pagar_7d,
      COALESCE(SUM(CASE WHEN tipo='receita' AND status='vencido' THEN valor END),0) AS vencido,
      COALESCE(SUM(CASE WHEN tipo='receita' AND status='pendente' THEN valor END),0) AS receita_prevista,
      COALESCE(SUM(CASE WHEN tipo='receita' AND status='pago'     THEN valor END),0) AS receita_realizada,
      COALESCE(SUM(CASE WHEN tipo='despesa' AND status='pendente' THEN valor END),0) AS despesa_prevista,
      COALESCE(SUM(CASE WHEN tipo='despesa' AND status='pago'     THEN valor END),0) AS despesa_paga
    FROM financial_records`) as any;
  const [[inst]] = await db.query(`
    SELECT
      COALESCE(SUM(CASE WHEN status='pendente' AND due_date <= CURDATE() THEN valor END),0) AS receber_hoje,
      COALESCE(SUM(CASE WHEN status='pendente' AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN valor END),0) AS receber_7d,
      COALESCE(SUM(CASE WHEN status='pendente' AND due_date < CURDATE() THEN valor END),0) AS vencido,
      COALESCE(SUM(CASE WHEN status='pendente' THEN valor END),0) AS parcelas_a_receber,
      COALESCE(SUM(CASE WHEN status='pago'     THEN valor END),0) AS parcelas_recebidas
    FROM installments`) as any;
  const [[t]] = await db.query("SELECT COUNT(*) total FROM tasks WHERE status NOT IN ('concluida','cancelada')") as any;
  const [[p]] = await db.query("SELECT COUNT(*) total FROM leads WHERE status = 'proposta_em_analise'") as any;

  const receitaPrev = Number(fr.receita_prevista) + Number(inst.parcelas_a_receber);
  const receitaReal = Number(fr.receita_realizada) + Number(inst.parcelas_recebidas);
  const vals: Record<string, number> = {
    receber_hoje: Number(fr.receber_hoje) + Number(inst.receber_hoje),
    receber_7d:   Number(fr.receber_7d)   + Number(inst.receber_7d),
    pagar_7d:     Number(fr.pagar_7d),
    inadimplencia: Number(fr.vencido)     + Number(inst.vencido),
    tarefas_pendentes: Number(t.total),
    propostas_analise: Number(p.total),
    receita_prevista: receitaPrev,
    receita_realizada: receitaReal,
    despesa_prevista: Number(fr.despesa_prevista),
    despesa_paga: Number(fr.despesa_paga),
    saldo_previsto: receitaPrev - Number(fr.despesa_prevista),
    saldo_realizado: receitaReal - Number(fr.despesa_paga),
  };

  const conn = await db.getConnection();
  try {
    for (const k of KEYS) {
      await conn.query(
        `INSERT INTO metric_snapshots (snapshot_date, metric_key, value)
         VALUES (DATE(CONVERT_TZ(NOW(),'+00:00','-03:00')), ?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value)`,
        [k, vals[k]]
      );
    }
  } finally { conn.release(); }
  return KEYS.length;
}

/** Série dos últimos N dias, agrupada por métrica: { chave: [{date, value}, …] }. */
export async function getSeries(days = 30): Promise<Record<string, { date: string; value: number }[]>> {
  const [rows] = await db.query(
    `SELECT snapshot_date, metric_key, value FROM metric_snapshots
      WHERE snapshot_date >= DATE_SUB(DATE(CONVERT_TZ(NOW(),'+00:00','-03:00')), INTERVAL ? DAY)
      ORDER BY snapshot_date ASC`, [days]) as any;
  const out: Record<string, { date: string; value: number }[]> = {};
  for (const r of rows) {
    (out[r.metric_key] ||= []).push({ date: r.snapshot_date, value: Number(r.value) });
  }
  return out;
}
