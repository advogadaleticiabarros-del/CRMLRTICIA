import { db } from '../config/database';

/**
 * Controladoria — rentabilidade (receita − custo) por cliente e por processo,
 * centro de custo e provisionamento. Lê das fontes já existentes; soma o que
 * foi efetivamente realizado (pago/recebido/repassado).
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

async function grouped(sql: string, params: any[] = []): Promise<{ k: number | string; total: number }[]> {
  const [rows] = await db.query(sql, params) as any;
  return rows;
}

type Acc = Record<string, { receita: number; custo: number }>;
function add(acc: Acc, key: any, field: 'receita' | 'custo', val: number) {
  if (key === null || key === undefined) return;
  const k = String(key);
  if (!acc[k]) acc[k] = { receita: 0, custo: 0 };
  acc[k][field] += Number(val) || 0;
}

// ── Rentabilidade por CLIENTE ───────────────────────────────────────────────
export async function rentabilidadeClientes() {
  const acc: Acc = {};

  // Receitas realizadas por cliente
  for (const r of await grouped(`SELECT client_id k, SUM(valor) total FROM financial_records WHERE tipo='receita' AND status='pago' AND client_id IS NOT NULL GROUP BY client_id`)) add(acc, r.k, 'receita', r.total);
  for (const r of await grouped(`SELECT r.client_id k, SUM(p.valor_final) total FROM parcelas p JOIN receitas r ON r.id=p.receita_id WHERE p.status='pago' GROUP BY r.client_id`)) add(acc, r.k, 'receita', r.total);
  for (const r of await grouped(`SELECT client_id k, SUM(valor) total FROM installments WHERE status='pago' AND client_id IS NOT NULL GROUP BY client_id`)) add(acc, r.k, 'receita', r.total);
  for (const r of await grouped(`SELECT client_id k, SUM(amount) total FROM cashflow_entries WHERE type='entrada' AND status='realizado' AND client_id IS NOT NULL GROUP BY client_id`)) add(acc, r.k, 'receita', r.total);
  for (const r of await grouped(`SELECT client_id k, SUM(honorarium_value) total FROM agreements WHERE status='Quitado' GROUP BY client_id`)) add(acc, r.k, 'receita', r.total);

  // Custos realizados por cliente
  for (const r of await grouped(`SELECT client_id k, SUM(valor) total FROM financial_records WHERE tipo='despesa' AND status='pago' AND client_id IS NOT NULL GROUP BY client_id`)) add(acc, r.k, 'custo', r.total);
  for (const r of await grouped(`SELECT client_id k, SUM(amount) total FROM cashflow_entries WHERE type='saida' AND status='realizado' AND client_id IS NOT NULL GROUP BY client_id`)) add(acc, r.k, 'custo', r.total);
  for (const r of await grouped(`SELECT c.client_id k, SUM(rp.valor) total FROM repasses rp JOIN cases c ON c.id=rp.case_id WHERE rp.status='repassado' GROUP BY c.client_id`)) add(acc, r.k, 'custo', r.total);

  const ids = Object.keys(acc);
  if (!ids.length) return [];
  const [names] = await db.query(`SELECT id, name FROM clients WHERE id IN (${ids.map(() => '?').join(',')})`, ids) as any;
  const nameMap = Object.fromEntries(names.map((n: any) => [String(n.id), n.name]));

  return ids.map((id) => {
    const { receita, custo } = acc[id];
    const lucro = receita - custo;
    return {
      client_id: Number(id), client_name: nameMap[id] || `Cliente #${id}`,
      receita: round2(receita), custo: round2(custo), lucro: round2(lucro),
      margem: receita > 0 ? round2((lucro / receita) * 100) : 0,
    };
  }).sort((a, b) => b.lucro - a.lucro);
}

// ── Rentabilidade por PROCESSO (caso) ───────────────────────────────────────
export async function rentabilidadeProcessos() {
  const acc: Acc = {};
  for (const r of await grouped(`SELECT case_id k, SUM(valor) total FROM financial_records WHERE tipo='receita' AND status='pago' AND case_id IS NOT NULL GROUP BY case_id`)) add(acc, r.k, 'receita', r.total);
  for (const r of await grouped(`SELECT r.case_id k, SUM(p.valor_final) total FROM parcelas p JOIN receitas r ON r.id=p.receita_id WHERE p.status='pago' AND r.case_id IS NOT NULL GROUP BY r.case_id`)) add(acc, r.k, 'receita', r.total);
  for (const r of await grouped(`SELECT case_id k, SUM(valor) total FROM installments WHERE status='pago' AND case_id IS NOT NULL GROUP BY case_id`)) add(acc, r.k, 'receita', r.total);
  for (const r of await grouped(`SELECT case_id k, SUM(amount) total FROM cashflow_entries WHERE type='entrada' AND status='realizado' AND case_id IS NOT NULL GROUP BY case_id`)) add(acc, r.k, 'receita', r.total);
  for (const r of await grouped(`SELECT case_id k, SUM(honorarium_value) total FROM agreements WHERE status='Quitado' AND case_id IS NOT NULL GROUP BY case_id`)) add(acc, r.k, 'receita', r.total);

  for (const r of await grouped(`SELECT case_id k, SUM(valor) total FROM financial_records WHERE tipo='despesa' AND status='pago' AND case_id IS NOT NULL GROUP BY case_id`)) add(acc, r.k, 'custo', r.total);
  for (const r of await grouped(`SELECT case_id k, SUM(amount) total FROM cashflow_entries WHERE type='saida' AND status='realizado' AND case_id IS NOT NULL GROUP BY case_id`)) add(acc, r.k, 'custo', r.total);
  for (const r of await grouped(`SELECT case_id k, SUM(valor) total FROM repasses WHERE status='repassado' AND case_id IS NOT NULL GROUP BY case_id`)) add(acc, r.k, 'custo', r.total);

  const ids = Object.keys(acc);
  if (!ids.length) return [];
  const [cases] = await db.query(`SELECT id, title FROM cases WHERE id IN (${ids.map(() => '?').join(',')})`, ids) as any;
  const titleMap = Object.fromEntries(cases.map((c: any) => [String(c.id), c.title]));

  return ids.map((id) => {
    const { receita, custo } = acc[id];
    const lucro = receita - custo;
    return {
      case_id: Number(id), case_title: titleMap[id] || `Processo #${id}`,
      receita: round2(receita), custo: round2(custo), lucro: round2(lucro),
      margem: receita > 0 ? round2((lucro / receita) * 100) : 0,
    };
  }).sort((a, b) => b.lucro - a.lucro);
}

// ── Centro de custo ─────────────────────────────────────────────────────────
export async function centroCusto() {
  const map: Record<string, { centro: string; receita: number; despesa: number }> = {};
  const put = (centro: string | null, field: 'receita' | 'despesa', val: number) => {
    const k = centro || '(sem centro)';
    if (!map[k]) map[k] = { centro: k, receita: 0, despesa: 0 };
    map[k][field] += Number(val) || 0;
  };
  for (const r of await grouped(`SELECT cost_center k, SUM(valor) total FROM financial_records WHERE tipo='receita' AND status='pago' GROUP BY cost_center`) as any) put(r.k, 'receita', r.total);
  for (const r of await grouped(`SELECT cost_center k, SUM(valor) total FROM financial_records WHERE tipo='despesa' AND status='pago' GROUP BY cost_center`) as any) put(r.k, 'despesa', r.total);
  for (const r of await grouped(`SELECT cost_center k, SUM(amount) total FROM cashflow_entries WHERE type='entrada' AND status='realizado' GROUP BY cost_center`) as any) put(r.k, 'receita', r.total);
  for (const r of await grouped(`SELECT cost_center k, SUM(amount) total FROM cashflow_entries WHERE type='saida' AND status='realizado' GROUP BY cost_center`) as any) put(r.k, 'despesa', r.total);

  return Object.values(map).map((c) => ({ ...c, receita: round2(c.receita), despesa: round2(c.despesa), saldo: round2(c.receita - c.despesa) }))
    .sort((a, b) => b.saldo - a.saldo);
}

// ── Provisionamento (resumo) ────────────────────────────────────────────────
export async function provisionamentoResumo() {
  const [rows] = await db.query(
    `SELECT type, likelihood, COUNT(*) qtd, COALESCE(SUM(value),0) total FROM case_provisions GROUP BY type, likelihood`
  ) as any;
  const matriz: Record<string, Record<string, { qtd: number; total: number }>> = {
    ganho: { provavel: { qtd: 0, total: 0 }, possivel: { qtd: 0, total: 0 }, remoto: { qtd: 0, total: 0 } },
    perda: { provavel: { qtd: 0, total: 0 }, possivel: { qtd: 0, total: 0 }, remoto: { qtd: 0, total: 0 } },
  };
  for (const r of rows) matriz[r.type][r.likelihood] = { qtd: Number(r.qtd), total: round2(Number(r.total)) };
  const sum = (t: string) => Object.values(matriz[t]).reduce((a, v) => a + v.total, 0);
  return { matriz, ganho_total: round2(sum('ganho')), perda_total: round2(sum('perda')) };
}
