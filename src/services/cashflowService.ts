import { db } from '../config/database';

/**
 * Fluxo de Caixa consolidado (híbrido): soma os lançamentos manuais
 * (cashflow_entries) + as fontes já existentes (parcelas, installments,
 * dativo, acordos, repasses, financial_records), agrupando por mês.
 * "Previsto" usa a data de vencimento; "Realizado" usa a data de pagamento.
 */

export const CATEGORY_PT: Record<string, string> = {
  honorario_inicial: 'Honorários iniciais', honorario_total: 'Honorários (totais)',
  honorario_parcela: 'Honorários (parcelas)', exito: 'Êxito / decisão',
  acordo: 'Acordos', dativo: 'Dativo (Estado)', correspondente: 'Correspondente jurídico',
  outro_entrada: 'Outras entradas', lanc_receita: 'Lançamentos (receita)',
  despesa_fixa: 'Despesas fixas', despesa_variavel: 'Despesas variáveis', repasse: 'Repasses',
  imposto: 'Impostos', salario: 'Salários', outro_saida: 'Outras saídas', lanc_despesa: 'Lançamentos (despesa)',
  // Grupos de despesa (contas a pagar)
  empresa: 'Empresa / Escritório', pessoal: 'Pessoal', cartao: 'Cartão de crédito', moradia: 'Moradia',
  impostos: 'Impostos & Tributos', salarios: 'Salários & Folha', fornecedores: 'Fornecedores',
  software: 'Software & Assinaturas', marketing: 'Marketing', transporte: 'Transporte & Deslocamento',
  extraordinaria: 'Despesas extraordinárias',
};

interface MonthBucket {
  mes: string;
  entrada_previsto: number; entrada_realizado: number;
  saida_previsto: number; saida_realizado: number;
}

function monthList(fromYM: string, months: number): string[] {
  const [y, m] = fromYM.split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < months; i++) { const d = new Date(y, m - 1 + i, 1); out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  return out;
}

interface SourceCfg {
  cat: string; type: 'entrada' | 'saida'; table: string; amount: string;
  dueCol: string; paidCol: string; realizedCond: string; extraWhere?: string;
}

const SOURCES: SourceCfg[] = [
  { cat: 'lanc_receita',      type: 'entrada', table: 'financial_records', amount: 'valor',       dueCol: 'due_date',        paidCol: 'paid_at',       realizedCond: "status='pago'",       extraWhere: "tipo='receita'" },
  { cat: 'honorario_inicial', type: 'entrada', table: 'installments',      amount: 'valor',       dueCol: 'due_date',        paidCol: 'paid_at',       realizedCond: "status='pago'" },
  { cat: 'honorario_parcela', type: 'entrada', table: 'parcelas',          amount: 'valor_final', dueCol: 'data_vencimento', paidCol: 'data_pagamento', realizedCond: "status='pago'" },
  { cat: 'dativo',            type: 'entrada', table: 'dative_payments',   amount: 'value',       dueCol: 'expected_date',   paidCol: 'received_date', realizedCond: "status='recebido'" },
  { cat: 'correspondente',    type: 'entrada', table: 'correspondent_hearings', amount: 'value',  dueCol: 'due_date',        paidCol: 'paid_at',       realizedCond: "status='paga'" },
  { cat: 'lanc_despesa',      type: 'saida',   table: 'financial_records', amount: 'valor',       dueCol: 'due_date',        paidCol: 'paid_at',       realizedCond: "status='pago'",       extraWhere: "tipo='despesa'" },
  { cat: 'repasse',           type: 'saida',   table: 'repasses',          amount: 'valor',       dueCol: 'data_vencimento', paidCol: 'data_repasse',  realizedCond: "status='repassado'" },
];

export async function getMonthlyCashflow(fromYM: string, months: number) {
  const [fy, fm] = fromYM.split('-').map(Number);
  const start = `${fy}-${String(fm).padStart(2, '0')}-01`;
  const endD = new Date(fy, fm - 1 + months, 1);
  const end = `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, '0')}-01`;

  const buckets: Record<string, MonthBucket> = {};
  for (const m of monthList(fromYM, months)) {
    buckets[m] = { mes: m, entrada_previsto: 0, entrada_realizado: 0, saida_previsto: 0, saida_realizado: 0 };
  }
  const cats: Record<string, { categoria: string; label: string; type: string; previsto: number; realizado: number }> = {};

  const addBucket = (mes: string, field: keyof MonthBucket, val: number) => {
    if (buckets[mes]) (buckets[mes] as any)[field] += Number(val) || 0;
  };
  const addCat = (cat: string, type: string, prev: number, real: number) => {
    if (!cats[cat]) cats[cat] = { categoria: cat, label: CATEGORY_PT[cat] || cat, type, previsto: 0, realizado: 0 };
    cats[cat].previsto += Number(prev) || 0; cats[cat].realizado += Number(real) || 0;
  };

  const run = async (sql: string, params: any[]) => { const [r] = await db.query(sql, params) as any; return r as { mes: string; total: number }[]; };

  for (const s of SOURCES) {
    const field = s.type === 'entrada' ? 'entrada' : 'saida';
    const extra = s.extraWhere ? ` AND ${s.extraWhere}` : '';
    // Previsto (por vencimento)
    for (const r of await run(
      `SELECT DATE_FORMAT(${s.dueCol},'%Y-%m') mes, SUM(${s.amount}) total FROM ${s.table}
       WHERE ${s.dueCol} >= ? AND ${s.dueCol} < ?${extra} GROUP BY mes`, [start, end])) {
      addBucket(r.mes, `${field}_previsto` as keyof MonthBucket, r.total); addCat(s.cat, s.type, r.total, 0);
    }
    // Realizado (por pagamento)
    for (const r of await run(
      `SELECT DATE_FORMAT(${s.paidCol},'%Y-%m') mes, SUM(${s.amount}) total FROM ${s.table}
       WHERE ${s.realizedCond} AND ${s.paidCol} >= ? AND ${s.paidCol} < ?${extra} GROUP BY mes`, [start, end])) {
      addBucket(r.mes, `${field}_realizado` as keyof MonthBucket, r.total); addCat(s.cat, s.type, 0, r.total);
    }
  }

  // Acordos (honorário do acordo, por 1º vencimento)
  for (const r of await run(
    `SELECT DATE_FORMAT(first_due_date,'%Y-%m') mes, SUM(honorarium_value) total FROM agreements
     WHERE first_due_date >= ? AND first_due_date < ? GROUP BY mes`, [start, end])) {
    addBucket(r.mes, 'entrada_previsto', r.total); addCat('acordo', 'entrada', r.total, 0);
  }
  for (const r of await run(
    `SELECT DATE_FORMAT(first_due_date,'%Y-%m') mes, SUM(honorarium_value) total FROM agreements
     WHERE status='Quitado' AND first_due_date >= ? AND first_due_date < ? GROUP BY mes`, [start, end])) {
    addBucket(r.mes, 'entrada_realizado', r.total); addCat('acordo', 'entrada', 0, r.total);
  }

  // Lançamentos manuais do fluxo de caixa (por categoria/tipo)
  const [cfPrev] = await db.query(
    `SELECT DATE_FORMAT(due_date,'%Y-%m') mes, type, category, SUM(amount) total FROM cashflow_entries
     WHERE due_date >= ? AND due_date < ? GROUP BY mes, type, category`, [start, end]) as any;
  for (const r of cfPrev) { addBucket(r.mes, `${r.type}_previsto` as keyof MonthBucket, r.total); addCat(r.category, r.type, r.total, 0); }
  const [cfReal] = await db.query(
    `SELECT DATE_FORMAT(COALESCE(paid_at,due_date),'%Y-%m') mes, type, category, SUM(amount) total FROM cashflow_entries
     WHERE status='realizado' AND COALESCE(paid_at,due_date) >= ? AND COALESCE(paid_at,due_date) < ? GROUP BY mes, type, category`, [start, end]) as any;
  for (const r of cfReal) { addBucket(r.mes, `${r.type}_realizado` as keyof MonthBucket, r.total); addCat(r.category, r.type, 0, r.total); }

  // Monta a série mensal com saldo e acumulado
  let accPrev = 0, accReal = 0;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const meses = monthList(fromYM, months).map((m) => {
    const b = buckets[m];
    const saldoPrev = b.entrada_previsto - b.saida_previsto;
    const saldoReal = b.entrada_realizado - b.saida_realizado;
    accPrev += saldoPrev; accReal += saldoReal;
    return {
      mes: m,
      entrada_previsto: round2(b.entrada_previsto), entrada_realizado: round2(b.entrada_realizado),
      saida_previsto: round2(b.saida_previsto), saida_realizado: round2(b.saida_realizado),
      saldo_previsto: round2(saldoPrev), saldo_realizado: round2(saldoReal),
      acumulado_previsto: round2(accPrev), acumulado_realizado: round2(accReal),
    };
  });

  const totais = meses.reduce((a, m) => ({
    entrada_previsto: a.entrada_previsto + m.entrada_previsto, entrada_realizado: a.entrada_realizado + m.entrada_realizado,
    saida_previsto: a.saida_previsto + m.saida_previsto, saida_realizado: a.saida_realizado + m.saida_realizado,
  }), { entrada_previsto: 0, entrada_realizado: 0, saida_previsto: 0, saida_realizado: 0 });

  return {
    from: fromYM, months,
    meses,
    categorias: Object.values(cats).map((c) => ({ ...c, previsto: round2(c.previsto), realizado: round2(c.realizado) }))
      .sort((a, b) => b.previsto - a.previsto),
    totais: {
      entrada_previsto: round2(totais.entrada_previsto), entrada_realizado: round2(totais.entrada_realizado),
      saida_previsto: round2(totais.saida_previsto), saida_realizado: round2(totais.saida_realizado),
      saldo_previsto: round2(totais.entrada_previsto - totais.saida_previsto),
      saldo_realizado: round2(totais.entrada_realizado - totais.saida_realizado),
    },
  };
}
