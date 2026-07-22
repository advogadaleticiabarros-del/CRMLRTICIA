import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { getReceitasRecebidasNoMes, getReceitasRecebidasNoAno, getJanelaFluxoCaixa, getInadimplencia } from '../services/monthlyFinance';

const router = Router();

const TIPOS = ['receita', 'despesa'];
const STATUSES = ['pendente', 'pago', 'vencido', 'cancelado'];
const RECURRENCES = ['mensal', 'trimestral', 'semestral', 'anual'];
const RECUR_MONTHS: Record<string, number> = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };

function addMonthsStr(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

// ── GET /api/financial — lançamentos (receitas/despesas) ────────────────────
// Sem filtro por usuário — o financeiro do escritório é um só (o filtro
// escondia lançamentos criados por outros usuários e ainda impedia dar baixa
// neles — ver o PATCH /:id/pay e o PUT /:id abaixo, mesmo problema).
router.get('/', async (req: Request, res: Response) => {
  const tipo       = req.query.tipo as string;
  const status     = req.query.status as string;
  const costCenter = req.query.cost_center as string;
  const page       = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit      = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));
  const offset     = (page - 1) * limit;

  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (tipo && TIPOS.includes(tipo))         { where.push('fr.tipo = ?'); params.push(tipo); }
  if (status && STATUSES.includes(status))  { where.push('fr.status = ?'); params.push(status); }
  if (costCenter) { where.push('fr.cost_center = ?'); params.push(costCenter); }
  const escopo = req.query.escopo as string;
  if (escopo === 'empresa' || escopo === 'pessoal') { where.push('fr.escopo = ?'); params.push(escopo); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM financial_records fr ${whereSql}`, params) as any;

  const [rows] = await db.query(
    `SELECT fr.id, fr.tipo, fr.description, fr.valor, fr.status, fr.due_date, fr.paid_at,
            fr.cost_center, fr.recurrence_type, fr.pagador, fr.banco, fr.escopo, cl.name AS client_name
     FROM financial_records fr
     LEFT JOIN clients cl ON cl.id = fr.client_id
     ${whereSql} ORDER BY fr.due_date DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as any;

  res.json({ data: rows, total, page, limit, pages: Math.ceil(total / limit) });
});

// ── GET /api/financial/opcoes — pagadoras e bancos já usados (sugestões) ─────
router.get('/opcoes', async (_req: Request, res: Response) => {
  const [pag] = await db.query("SELECT DISTINCT pagador FROM financial_records WHERE pagador IS NOT NULL AND pagador <> '' ORDER BY pagador") as any;
  const [ban] = await db.query("SELECT DISTINCT banco FROM financial_records WHERE banco IS NOT NULL AND banco <> '' ORDER BY banco") as any;
  res.json({ pagadores: pag.map((r: any) => r.pagador), bancos: ban.map((r: any) => r.banco) });
});

// ── GET /api/financial/summary — KPIs consolidados de TODAS as frentes ───────
// Clientes próprios + parcerias (entrada/êxito/sucumbência) + dativas +
// correspondente, e saídas = despesas + repasses. Sem filtro por usuário —
// o financeiro do escritório é um só.
router.get('/summary', async (_req: Request, res: Response) => {
  const { getFinanceSummary } = await import('../services/financeSummary');
  res.json(await getFinanceSummary());
});

// ── GET /api/financial/inteligencia — projeção de caixa, DRE e inadimplência ──
// Alimenta o painel financeiro do Dashboard. Usa a MESMA fonte de verdade dos
// outros relatórios (services/monthlyFinance) — antes tinha sua própria query
// desatualizada: filtrava por usuário e nunca somava dativo, correspondente,
// êxitos (case_awards) ou a tabela `parcelas`, então mostrava números bem
// menores que a realidade.
router.get('/inteligencia', async (_req: Request, res: Response) => {
  const N = (x: any) => Number(x) || 0;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;

  const [d30, d60, d90] = await Promise.all([
    getJanelaFluxoCaixa(0, 30), getJanelaFluxoCaixa(31, 60), getJanelaFluxoCaixa(61, 90),
  ]);
  const projecao = [
    { dias: 30, ...d30 }, { dias: 60, ...d60 }, { dias: 90, ...d90 },
  ];

  const [[despMes]] = await db.query(
    `SELECT COALESCE(SUM(valor),0) AS v FROM financial_records WHERE tipo='despesa' AND status='pago' AND DATE_FORMAT(paid_at,'%Y-%m') = ?`, [mesAtual]
  ) as any;
  const [[despAno]] = await db.query(
    `SELECT COALESCE(SUM(valor),0) AS v FROM financial_records WHERE tipo='despesa' AND status='pago' AND YEAR(paid_at) = ?`, [hoje.getFullYear()]
  ) as any;

  const recMes = (await getReceitasRecebidasNoMes(mesAtual)).total;
  const recAno = await getReceitasRecebidasNoAno(hoje.getFullYear());
  const dre = {
    mes: { receitas: recMes, despesas: round2(N(despMes.v)), resultado: round2(recMes - N(despMes.v)) },
    ano: { receitas: recAno, despesas: round2(N(despAno.v)), resultado: round2(recAno - N(despAno.v)) },
  };

  const inadimplencia = await getInadimplencia();

  res.json({ projecao, dre, inadimplencia });
});

// ── POST /api/financial — criar lançamento ──────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { tipo, description, valor, due_date, status, cost_center, recurrence_type, client_id, case_id, pagador, banco, escopo } = req.body;
  if (!TIPOS.includes(tipo)) { res.status(400).json({ error: "tipo deve ser 'receita' ou 'despesa'" }); return; }
  if (!description || !String(description).trim()) { res.status(400).json({ error: 'A descrição é obrigatória' }); return; }

  const recur = RECURRENCES.includes(recurrence_type) ? recurrence_type : null;
  const nextDue = recur && due_date ? addMonthsStr(due_date, RECUR_MONTHS[recur]) : null;
  const esc = escopo === 'pessoal' ? 'pessoal' : 'empresa';

  const [result] = await db.query(
    `INSERT INTO financial_records
       (user_id, client_id, case_id, tipo, description, valor, status, due_date, cost_center, recurrence_type, next_due_date, pagador, banco, escopo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user!.id, client_id ?? null, case_id ?? null, tipo, description.trim(),
     Number(valor) || 0, STATUSES.includes(status) ? status : 'pendente',
     due_date || null, cost_center ?? null, recur, nextDue,
     (pagador && String(pagador).trim()) || null, (banco && String(banco).trim()) || null, esc]
  ) as any;

  const [rows] = await db.query('SELECT * FROM financial_records WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── PATCH /api/financial/:id/pay — dar baixa (pagar/receber) ────────────────
// Sem filtro por usuário — dar baixa num lançamento que outra pessoa da
// equipe registrou é normal (era o motivo do "não encontrado" ao tentar
// baixar um lançamento de outro usuário, mesmo ele existindo).
router.patch('/:id/pay', async (req: Request, res: Response) => {
  const [result] = await db.query(
    "UPDATE financial_records SET status = 'pago', paid_at = NOW() WHERE id = ?",
    [req.params.id]
  ) as any;
  if (!result.affectedRows) { res.status(404).json({ error: 'Lançamento não encontrado' }); return; }
  res.json({ success: true, id: Number(req.params.id), status: 'pago' });
});

// ── PUT /api/financial/:id ──────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT id FROM financial_records WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Lançamento não encontrado' }); return; }

  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };
  setIf('description', req.body.description?.trim?.());
  setIf('valor', req.body.valor !== undefined ? Number(req.body.valor) : undefined);
  setIf('due_date', req.body.due_date);
  setIf('status', req.body.status, STATUSES.includes(req.body.status));
  setIf('cost_center', req.body.cost_center);
  setIf('pagador', req.body.pagador);
  setIf('banco', req.body.banco);
  setIf('escopo', req.body.escopo, req.body.escopo === 'empresa' || req.body.escopo === 'pessoal');

  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido para atualizar' }); return; }
  params.push(id);
  await db.query(`UPDATE financial_records SET ${fields.join(', ')} WHERE id = ?`, params);

  const [rows] = await db.query('SELECT * FROM financial_records WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

// ── GET /api/financial/installments — parcelas de propostas ─────────────────
router.get('/installments', async (req: Request, res: Response) => {
  const status   = req.query.status as string;
  const clientId = req.query.client_id as string;

  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (status && ['pendente','pago','vencido','cancelado'].includes(status)) { where.push('i.status = ?'); params.push(status); }
  if (clientId) { where.push('i.client_id = ?'); params.push(clientId); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [rows] = await db.query(
    `SELECT i.id, i.numero, i.valor, i.due_date, i.paid_at, i.status,
            cl.name AS client_name, p.title AS proposta_title,
            CASE WHEN i.status = 'pendente' AND i.due_date < CURDATE() THEN 1 ELSE 0 END AS vencida
     FROM installments i
     LEFT JOIN clients cl ON cl.id = i.client_id
     LEFT JOIN propostas p ON p.id = i.proposta_id
     ${whereSql} ORDER BY i.due_date ASC LIMIT 200`,
    params
  ) as any;

  res.json(rows);
});

// Monta a lista unificada do "A Receber" (usada também pela conciliação OFX).
async function montarAReceber(): Promise<any[]> {
  const rows: any[] = [];
  const N = (x: any) => Number(x) || 0;
  const hoje = new Date().toISOString().split('T')[0];

  const [fr] = await db.query(`
    SELECT fr.id, fr.description, fr.valor, fr.due_date, fr.status, fr.paid_at, cl.name AS client_name
      FROM financial_records fr LEFT JOIN clients cl ON cl.id = fr.client_id
     WHERE fr.tipo='receita' AND fr.status IN ('pendente','vencido','pago')
     ORDER BY fr.due_date DESC LIMIT 300`) as any;
  for (const r of fr) rows.push({
    fonte: 'lancamento', id: r.id, descricao: r.description, cliente: r.client_name,
    valor: N(r.valor), vencimento: r.due_date, recebido: r.status === 'pago', pago_em: r.paid_at,
  });

  const [inst] = await db.query(`
    SELECT i.id, i.numero, i.valor, i.due_date, i.status, i.paid_at, cl.name AS client_name, p.title AS proposta_title
      FROM installments i
      LEFT JOIN clients cl ON cl.id = i.client_id
      LEFT JOIN propostas p ON p.id = i.proposta_id
     WHERE i.status IN ('pendente','em_processamento','vencido','pago')
     ORDER BY i.due_date DESC LIMIT 300`) as any;
  for (const r of inst) rows.push({
    fonte: 'parcela', id: r.id, descricao: `${r.numero}ª parcela${r.proposta_title ? ' — ' + r.proposta_title : ''}`,
    cliente: r.client_name, valor: N(r.valor), vencimento: r.due_date, recebido: r.status === 'pago', pago_em: r.paid_at,
  });

  const [parc] = await db.query(`
    SELECT pa.id, pa.numero, pa.total_parcelas, pa.valor_final, pa.data_vencimento, pa.status, pa.data_pagamento,
           re.descricao AS receita_desc, cl.name AS client_name
      FROM parcelas pa
      LEFT JOIN receitas re ON re.id = pa.receita_id
      LEFT JOIN clients cl ON cl.id = re.client_id
     WHERE pa.status IN ('aberto','atrasado','parcial','pago')
     ORDER BY pa.data_vencimento DESC LIMIT 300`).catch(() => [[]]) as any;
  for (const r of parc) rows.push({
    fonte: 'contrato', id: r.id, descricao: `${r.numero}/${r.total_parcelas}${r.receita_desc ? ' — ' + r.receita_desc : ''}`,
    cliente: r.client_name, valor: N(r.valor_final), vencimento: r.data_vencimento, recebido: r.status === 'pago', pago_em: r.data_pagamento,
  });

  const [dat] = await db.query(`
    SELECT dp.id, dp.reference, dp.value, dp.expected_date, dp.received_date, dp.status, dc.process_number
      FROM dative_payments dp LEFT JOIN dative_cases dc ON dc.id = dp.dative_case_id
     ORDER BY COALESCE(dp.expected_date, dp.received_date) DESC LIMIT 300`) as any;
  for (const r of dat) rows.push({
    fonte: 'dativo', id: r.id, descricao: r.reference || `Dativo${r.process_number ? ' — proc. ' + r.process_number : ''}`,
    cliente: 'Estado (dativo)', valor: N(r.value), vencimento: r.expected_date, recebido: r.status === 'recebido', pago_em: r.received_date,
  });

  // Nomeações dativas sem recebimento lançado — o estimado é o "a receber".
  const [datCasos] = await db.query(`
    SELECT dc.id, dc.assisted_name, dc.comarca, dc.process_number, dc.estimated_value
      FROM dative_cases dc
     WHERE dc.status <> 'paga' AND dc.estimated_value > 0
       AND NOT EXISTS (SELECT 1 FROM dative_payments dp WHERE dp.dative_case_id = dc.id)
     ORDER BY dc.nomeacao_date DESC LIMIT 300`) as any;
  for (const r of datCasos) rows.push({
    fonte: 'dativo_caso', id: r.id,
    descricao: `Nomeação — ${r.assisted_name || 'assistido'} (${r.comarca}${r.process_number ? ' · ' + r.process_number : ''})`,
    cliente: 'Estado (dativo)', valor: N(r.estimated_value), vencimento: null, recebido: false, pago_em: null,
  });

  const [corr] = await db.query(`
    SELECT id, payer_name, process_number, value, due_date, paid_at, status
      FROM correspondent_hearings WHERE status IN ('agendada','realizada','faturada','paga')
     ORDER BY due_date DESC LIMIT 300`) as any;
  for (const r of corr) rows.push({
    fonte: 'correspondente', id: r.id, descricao: `Audiência — ${r.payer_name || '—'}${r.process_number ? ' (' + r.process_number + ')' : ''}`,
    cliente: r.payer_name || '—', valor: N(r.value), vencimento: r.due_date, recebido: r.status === 'paga', pago_em: r.paid_at,
  });

  const KIND_PT: Record<string, string> = { rpv: 'RPV', precatorio: 'Precatório', alvara: 'Alvará', acordo: 'Acordo', outro: 'Êxito' };
  const [aw] = await db.query(`
    SELECT a.id, a.kind, a.descricao, a.valor_escritorio, a.previsao_pagamento, a.data_recebimento, a.status,
           cl.name AS client_name, c.case_number
      FROM case_awards a
      LEFT JOIN clients cl ON cl.id = a.client_id
      LEFT JOIN cases c ON c.id = a.case_id
     WHERE a.status IN ('aguardando','recebido')
     ORDER BY COALESCE(a.previsao_pagamento, a.data_recebimento) DESC LIMIT 300`).catch(() => [[]]) as any;
  for (const r of aw) rows.push({
    fonte: 'exito', id: r.id,
    descricao: `${KIND_PT[r.kind] || r.kind}${r.descricao ? ' — ' + r.descricao : ''}${r.case_number ? ' (proc. ' + r.case_number + ')' : ''}`,
    cliente: r.client_name || '—', valor: N(r.valor_escritorio), vencimento: r.previsao_pagamento,
    recebido: r.status === 'recebido', pago_em: r.data_recebimento,
  });

  for (const r of rows) {
    r.vencido = !r.recebido && r.vencimento && String(r.vencimento).slice(0, 10) < hoje;
  }
  rows.sort((a, b) => String(b.vencimento || '').localeCompare(String(a.vencimento || '')));
  return rows;
}

// ── GET /api/financial/a-receber — TUDO a receber, de todas as frentes ───────
// Uma lista só: lançamentos, parcelas de propostas, parcelas de contratos,
// dativas, correspondente e êxitos. Cada linha diz de onde veio (fonte) para
// o front chamar o endpoint certo de recebimento. Valores sempre numéricos.
router.get('/a-receber', async (_req: Request, res: Response) => {
  const rows = await montarAReceber();
  const kpis = {
    programado: rows.reduce((s, r) => s + r.valor, 0),
    recebido: rows.filter((r) => r.recebido).reduce((s, r) => s + r.valor, 0),
    a_receber: rows.filter((r) => !r.recebido).reduce((s, r) => s + r.valor, 0),
    vencido: rows.filter((r) => r.vencido).reduce((s, r) => s + r.valor, 0),
  };
  const round2 = (n: number) => Math.round(n * 100) / 100;
  res.json({
    kpis: { programado: round2(kpis.programado), recebido: round2(kpis.recebido), a_receber: round2(kpis.a_receber), vencido: round2(kpis.vencido) },
    rows,
  });
});

// ── POST /api/financial/conciliar — conciliação bancária via extrato OFX ─────
// Recebe o texto do arquivo OFX do banco e cruza os CRÉDITOS com o A Receber:
// - "conferido": valor bate com item já marcado como recebido (±3 dias)
// - "sugestao": valor bate com item PENDENTE (provável baixa esquecida)
// - "sem_correspondencia": entrou no banco mas o CRM não conhece
// Nada é gravado — é uma conferência; a baixa continua manual no A Receber.
router.post('/conciliar', async (req: Request, res: Response) => {
  const ofx = String(req.body?.ofx || '');
  if (!ofx.includes('<STMTTRN>')) { res.status(400).json({ error: 'Arquivo OFX inválido — exporte o extrato no formato OFX no site do banco' }); return; }

  const parseData = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const tag = (bloco: string, t: string) => {
    const m = bloco.match(new RegExp(`<${t}>([^<\\r\\n]+)`, 'i'));
    return m ? m[1].trim() : '';
  };
  const trans: { data: string; valor: number; memo: string; fitid: string; tipo: 'credito' | 'debito' }[] = [];
  for (const m of ofx.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)) {
    const b = m[1];
    const valor = Number(tag(b, 'TRNAMT').replace(',', '.')) || 0;
    if (!valor) continue;
    trans.push({
      data: parseData(tag(b, 'DTPOSTED')), valor: Math.abs(Math.round(valor * 100) / 100),
      memo: tag(b, 'MEMO') || tag(b, 'NAME') || '—', fitid: tag(b, 'FITID'),
      tipo: valor > 0 ? 'credito' : 'debito',
    });
  }

  const rows = await montarAReceber();
  const diffDias = (a: string, b: string) => Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
  const usados = new Set<string>();

  const resultado = trans.filter((t) => t.tipo === 'credito').map((t) => {
    // 1º tenta um recebido com mesmo valor perto da data do crédito
    const conferido = rows.find((r) => r.recebido && !usados.has(`${r.fonte}:${r.id}`) &&
      Math.abs(r.valor - t.valor) < 0.01 && r.pago_em && diffDias(String(r.pago_em).slice(0, 10), t.data) <= 3);
    if (conferido) { usados.add(`${conferido.fonte}:${conferido.id}`); return { ...t, situacao: 'conferido', item: conferido }; }
    // 2º tenta um PENDENTE com mesmo valor (baixa provavelmente esquecida)
    const sugestao = rows.find((r) => !r.recebido && !usados.has(`${r.fonte}:${r.id}`) &&
      Math.abs(r.valor - t.valor) < 0.01 && (!r.vencimento || diffDias(String(r.vencimento).slice(0, 10), t.data) <= 15));
    if (sugestao) { usados.add(`${sugestao.fonte}:${sugestao.id}`); return { ...t, situacao: 'sugestao', item: sugestao }; }
    return { ...t, situacao: 'sem_correspondencia', item: null };
  });

  res.json({
    creditos: resultado,
    debitos_ignorados: trans.filter((t) => t.tipo === 'debito').length,
    resumo: {
      conferidos: resultado.filter((r) => r.situacao === 'conferido').length,
      sugestoes: resultado.filter((r) => r.situacao === 'sugestao').length,
      sem_correspondencia: resultado.filter((r) => r.situacao === 'sem_correspondencia').length,
    },
  });
});

// ── GET /api/financial/projecao — fluxo de caixa 30/60/90 dias ──────────────
// Entradas previstas de TODAS as frentes (parcelas, avulsos, dativas,
// correspondente, êxitos) − saídas previstas (despesas + repasses).
router.get('/projecao', async (_req: Request, res: Response) => {
  const [d30, d60, d90] = await Promise.all([
    getJanelaFluxoCaixa(0, 30), getJanelaFluxoCaixa(31, 60), getJanelaFluxoCaixa(61, 90),
  ]);
  res.json({
    d30, d60, d90,
    acumulado: { d30: d30.saldo, d60: d30.saldo + d60.saldo, d90: d30.saldo + d60.saldo + d90.saldo },
  });
});

// ── GET /api/financial/dre?month=YYYY-MM — fechamento do mês (contador) ─────
// ANTES ESTAVA INCOMPLETO: "entradas_parceria" caçava a receita por texto
// (description LIKE 'Entrada parceria%'), então os honorários de ACORDO e de
// ÊXITO das parcerias caíam sempre no balaio "demais receitas" — ou pior,
// ficavam fora se o texto não batesse. Nunca somava a tabela `parcelas`
// (contratos com parcelamento próprio) nem os êxitos de `case_awards`
// (RPV/precatório/alvará). Agora usa a mesma fonte dos outros relatórios.
router.get('/dre', async (req: Request, res: Response) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : new Date().toISOString().slice(0, 7);
  const rec = await getReceitasRecebidasNoMes(month);

  const [despesas] = await db.query(`
    SELECT COALESCE(cost_center, 'Sem categoria') AS categoria, SUM(valor) AS total
      FROM financial_records
     WHERE tipo='despesa' AND status='pago' AND DATE_FORMAT(COALESCE(paid_at, due_date),'%Y-%m') = ?
     GROUP BY COALESCE(cost_center, 'Sem categoria') ORDER BY total DESC`, [month]) as any;
  const [repasses] = await db.query(`
    SELECT COALESCE(SUM(valor),0) AS total FROM repasses
     WHERE status='repassado' AND DATE_FORMAT(data_repasse,'%Y-%m') = ?`, [month]) as any;

  // "Demais receitas" = avulsas de clientes (fora de parcelamento) + êxitos —
  // exatamente o que o rótulo do relatório promete ("êxito, sucumbência, avulsas").
  const receitas = {
    parcelas_contratos: rec.parcelas_contratos,
    entradas_parceria: rec.entradas_parceria,
    dativo: rec.dativo,
    correspondente: rec.correspondente,
    demais_receitas: Math.round((rec.avulsas_clientes + rec.exitos) * 100) / 100,
  };
  const receita_total = rec.total;
  const despesa_total = despesas.reduce((s: number, d: any) => s + Number(d.total), 0);
  const repasses_pagos = Number(repasses[0]?.total || 0);
  res.json({
    month, receitas, receita_total, despesas, despesa_total, repasses_pagos,
    resultado: receita_total - despesa_total - repasses_pagos,
  });
});

// ── GET /api/financial/receita-origem?month — receita recebida por área/parceria
// ANTES ESTAVA INCOMPLETO: só olhava `installments` (parcelas de propostas).
// Lançamentos avulsos, parcelas de contrato (`parcelas`) e êxitos
// (`case_awards`) ficavam de fora — a área "sem área" ficava artificialmente
// pequena e a real produção por área não aparecia.
router.get('/receita-origem', async (req: Request, res: Response) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : new Date().toISOString().slice(0, 7);

  const [porArea] = await db.query(`
    SELECT area, SUM(valor) AS total FROM (
      SELECT COALESCE(c.legal_area,'sem área') AS area, i.valor AS valor
        FROM installments i LEFT JOIN cases c ON c.id = i.case_id
       WHERE i.status='pago' AND DATE_FORMAT(i.paid_at,'%Y-%m') = ?
      UNION ALL
      SELECT COALESCE(c.legal_area,'sem área') AS area, pa.valor_final AS valor
        FROM parcelas pa LEFT JOIN receitas re ON re.id = pa.receita_id LEFT JOIN cases c ON c.id = re.case_id
       WHERE pa.status='pago' AND DATE_FORMAT(pa.data_pagamento,'%Y-%m') = ?
      UNION ALL
      SELECT COALESCE(c.legal_area,'sem área') AS area, fr.valor AS valor
        FROM financial_records fr LEFT JOIN cases c ON c.id = fr.case_id
       WHERE fr.tipo='receita' AND fr.status='pago' AND DATE_FORMAT(COALESCE(fr.paid_at, fr.due_date),'%Y-%m') = ?
      UNION ALL
      SELECT COALESCE(c.legal_area,'sem área') AS area, aw.valor_escritorio AS valor
        FROM case_awards aw LEFT JOIN cases c ON c.id = aw.case_id
       WHERE aw.status='recebido' AND DATE_FORMAT(aw.data_recebimento,'%Y-%m') = ?
      UNION ALL
      SELECT COALESCE(dc.area,'previdenciario') AS area, dp.value AS valor
        FROM dative_payments dp LEFT JOIN dative_cases dc ON dc.id = dp.dative_case_id
       WHERE dp.status='recebido' AND DATE_FORMAT(dp.received_date,'%Y-%m') = ?
    ) tudo
    GROUP BY area ORDER BY total DESC`, [month, month, month, month, month]) as any;

  const [porParceiro] = await db.query(`
    SELECT parceiro, SUM(recebido) AS recebido, MAX(repassado) AS repassado FROM (
      SELECT p.id AS pid, p.name AS parceiro, i.valor AS recebido, 0 AS repassado
        FROM partners p JOIN cases c ON c.partner_id = p.id JOIN installments i ON i.case_id = c.id
       WHERE i.status='pago' AND DATE_FORMAT(i.paid_at,'%Y-%m') = ?
      UNION ALL
      SELECT p.id AS pid, p.name AS parceiro, fr.valor AS recebido, 0 AS repassado
        FROM partners p JOIN cases c ON c.partner_id = p.id JOIN financial_records fr ON fr.case_id = c.id
       WHERE fr.tipo='receita' AND fr.status='pago' AND DATE_FORMAT(COALESCE(fr.paid_at, fr.due_date),'%Y-%m') = ?
      UNION ALL
      SELECT p.id AS pid, p.name AS parceiro, aw.valor_escritorio AS recebido, 0 AS repassado
        FROM partners p JOIN cases c ON c.partner_id = p.id JOIN case_awards aw ON aw.case_id = c.id
       WHERE aw.status='recebido' AND DATE_FORMAT(aw.data_recebimento,'%Y-%m') = ?
      UNION ALL
      SELECT p.id AS pid, p.name AS parceiro, 0 AS recebido,
             (SELECT COALESCE(SUM(r.valor),0) FROM repasses r JOIN cases c2 ON c2.id = r.case_id
                WHERE c2.partner_id = p.id AND r.status='repassado' AND DATE_FORMAT(r.data_repasse,'%Y-%m') = ?) AS repassado
        FROM partners p
    ) tudo
    GROUP BY pid, parceiro HAVING recebido > 0 OR repassado > 0 ORDER BY recebido DESC`, [month, month, month, month]) as any;

  res.json({ month, por_area: porArea, por_parceiro: porParceiro });
});

// ── POST /api/financial/renegociar — parcela(s) vencida(s) → novo parcelamento
router.post('/renegociar', async (req: Request, res: Response) => {
  const { client_id, installment_ids, num_parcelas, primeira_data, valor_total } = req.body || {};
  const ids: number[] = Array.isArray(installment_ids) ? installment_ids.map(Number).filter(Boolean) : [];
  const n = Math.min(36, Math.max(1, parseInt(num_parcelas) || 0));
  if (!client_id || !ids.length || !n || !primeira_data) {
    res.status(400).json({ error: 'Informe cliente, parcelas, quantidade e primeira data' }); return;
  }
  const [olds] = await db.query(
    `SELECT id, valor, case_id, proposta_id FROM installments
      WHERE id IN (${ids.map(() => '?').join(',')}) AND client_id = ? AND status IN ('pendente','vencido','em_processamento')`,
    [...ids, client_id]) as any;
  if (!olds.length) { res.status(400).json({ error: 'Nenhuma parcela renegociável encontrada' }); return; }

  const totalOriginal = olds.reduce((s: number, o: any) => s + Number(o.valor), 0);
  const total = Number(valor_total) > 0 ? Math.round(Number(valor_total) * 100) / 100 : totalOriginal;
  const base = Math.floor((total / n) * 100) / 100;
  const resto = Math.round((total - base * n) * 100) / 100; // diferença de centavos vai na 1ª

  // Cancela as antigas e cria as novas (acordo registrado na timeline)
  await db.query(
    `UPDATE installments SET status='cancelado' WHERE id IN (${olds.map(() => '?').join(',')})`,
    olds.map((o: any) => o.id));
  const ref = olds[0];
  for (let i = 0; i < n; i++) {
    const valor = i === 0 ? base + resto : base;
    await db.query(
      `INSERT INTO installments (client_id, proposta_id, case_id, numero, valor, due_date, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pendente')`,
      [client_id, ref.proposta_id ?? null, ref.case_id ?? null, i + 1, valor, addMonthsStr(primeira_data, i)]);
  }
  const { logTimeline } = await import('../services/TimelineService');
  await logTimeline({
    clientId: Number(client_id), caseId: ref.case_id ?? null, eventType: 'financeiro',
    description: `Renegociação: ${olds.length} parcela(s) (R$ ${totalOriginal.toFixed(2)}) viraram ${n}x de R$ ${base.toFixed(2)} a partir de ${primeira_data}${total !== totalOriginal ? ` · total acordado R$ ${total.toFixed(2)}` : ''}.`,
    userId: req.user!.id,
  }).catch(() => {});
  res.status(201).json({ success: true, canceladas: olds.length, criadas: n, total });
});

// ── PATCH /api/financial/installments/:id/pay — dar baixa na parcela ────────
router.patch('/installments/:id/pay', async (req: Request, res: Response) => {
  const [result] = await db.query(
    "UPDATE installments SET status = 'pago', paid_at = NOW() WHERE id = ?",
    [req.params.id]
  ) as any;
  if (!result.affectedRows) { res.status(404).json({ error: 'Parcela não encontrada' }); return; }

  // Recibo automático por e-mail ao cliente (best-effort)
  try {
    const [[info]] = await db.query(
      `SELECT i.valor, i.numero, cl.name, cl.email, pr.title AS proposta
         FROM installments i
         JOIN clients cl ON cl.id = i.client_id
         LEFT JOIN propostas pr ON pr.id = i.proposta_id
        WHERE i.id = ?`, [req.params.id]) as any;
    if (info?.email && info.email.includes('@')) {
      const { sendReceipt } = await import('../services/EmailService');
      sendReceipt(info.email, {
        name: info.name,
        valor: Number(info.valor),
        referencia: `${info.numero ? info.numero + 'ª parcela' : 'Parcela'}${info.proposta ? ` — ${info.proposta}` : ''}`,
        pagoEm: new Date(),
        numeroRecibo: `I${req.params.id}-${new Date().getFullYear()}`,
      }).catch(() => {});
    }
  } catch { /* recibo é best-effort */ }

  res.json({ success: true, id: Number(req.params.id), status: 'pago' });
});

export default router;
