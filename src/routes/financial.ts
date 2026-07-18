import { Router, Request, Response } from 'express';
import { db } from '../config/database';

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
router.get('/', async (req: Request, res: Response) => {
  const tipo       = req.query.tipo as string;
  const status     = req.query.status as string;
  const costCenter = req.query.cost_center as string;
  const page       = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit      = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));
  const offset     = (page - 1) * limit;

  const where: string[] = ['fr.user_id = ?'];
  const params: any[] = [req.user!.id];
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
router.get('/opcoes', async (req: Request, res: Response) => {
  const [pag] = await db.query("SELECT DISTINCT pagador FROM financial_records WHERE user_id = ? AND pagador IS NOT NULL AND pagador <> '' ORDER BY pagador", [req.user!.id]) as any;
  const [ban] = await db.query("SELECT DISTINCT banco FROM financial_records WHERE user_id = ? AND banco IS NOT NULL AND banco <> '' ORDER BY banco", [req.user!.id]) as any;
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
router.get('/inteligencia', async (req: Request, res: Response) => {
  const userId = req.user!.id;

  // Lançamentos avulsos (financial_records) — por usuário
  const [[fr]] = await db.query(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo='receita' AND status='pendente' AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN valor END),0) AS ent_30,
      COALESCE(SUM(CASE WHEN tipo='receita' AND status='pendente' AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 60 DAY) THEN valor END),0) AS ent_60,
      COALESCE(SUM(CASE WHEN tipo='receita' AND status='pendente' AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY) THEN valor END),0) AS ent_90,
      COALESCE(SUM(CASE WHEN tipo='despesa' AND status='pendente' AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN valor END),0) AS sai_30,
      COALESCE(SUM(CASE WHEN tipo='despesa' AND status='pendente' AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 60 DAY) THEN valor END),0) AS sai_60,
      COALESCE(SUM(CASE WHEN tipo='despesa' AND status='pendente' AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY) THEN valor END),0) AS sai_90,
      COALESCE(SUM(CASE WHEN tipo='receita' AND status='pago' AND paid_at >= DATE_FORMAT(CURDATE(),'%Y-%m-01') THEN valor END),0) AS rec_mes,
      COALESCE(SUM(CASE WHEN tipo='despesa' AND status='pago' AND paid_at >= DATE_FORMAT(CURDATE(),'%Y-%m-01') THEN valor END),0) AS desp_mes,
      COALESCE(SUM(CASE WHEN tipo='receita' AND status='pago' AND YEAR(paid_at)=YEAR(CURDATE()) THEN valor END),0) AS rec_ano,
      COALESCE(SUM(CASE WHEN tipo='despesa' AND status='pago' AND YEAR(paid_at)=YEAR(CURDATE()) THEN valor END),0) AS desp_ano,
      COALESCE(SUM(CASE WHEN tipo='receita' AND status IN ('pendente','vencido') AND due_date < CURDATE() AND DATEDIFF(CURDATE(),due_date) BETWEEN 1 AND 30 THEN valor END),0) AS aging1,
      COALESCE(SUM(CASE WHEN tipo='receita' AND status IN ('pendente','vencido') AND due_date < CURDATE() AND DATEDIFF(CURDATE(),due_date) BETWEEN 31 AND 60 THEN valor END),0) AS aging2,
      COALESCE(SUM(CASE WHEN tipo='receita' AND status IN ('pendente','vencido') AND due_date < CURDATE() AND DATEDIFF(CURDATE(),due_date) > 60 THEN valor END),0) AS aging3
    FROM financial_records WHERE user_id = ?`, [userId]) as any;

  // Parcelas (installments) — sempre receita; mesma base do /summary (global)
  const [[inst]] = await db.query(`
    SELECT
      COALESCE(SUM(CASE WHEN status='pendente' AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN valor END),0) AS ent_30,
      COALESCE(SUM(CASE WHEN status='pendente' AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 60 DAY) THEN valor END),0) AS ent_60,
      COALESCE(SUM(CASE WHEN status='pendente' AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY) THEN valor END),0) AS ent_90,
      COALESCE(SUM(CASE WHEN status='pago' AND paid_at >= DATE_FORMAT(CURDATE(),'%Y-%m-01') THEN valor END),0) AS rec_mes,
      COALESCE(SUM(CASE WHEN status='pago' AND YEAR(paid_at)=YEAR(CURDATE()) THEN valor END),0) AS rec_ano,
      COALESCE(SUM(CASE WHEN status IN ('pendente','vencido') AND due_date < CURDATE() AND DATEDIFF(CURDATE(),due_date) BETWEEN 1 AND 30 THEN valor END),0) AS aging1,
      COALESCE(SUM(CASE WHEN status IN ('pendente','vencido') AND due_date < CURDATE() AND DATEDIFF(CURDATE(),due_date) BETWEEN 31 AND 60 THEN valor END),0) AS aging2,
      COALESCE(SUM(CASE WHEN status IN ('pendente','vencido') AND due_date < CURDATE() AND DATEDIFF(CURDATE(),due_date) > 60 THEN valor END),0) AS aging3
    FROM installments`, []) as any;

  const N = (x: any) => Number(x) || 0;
  const ent = (k: string) => N(fr[k]) + N(inst[k]);
  const projecao = [30, 60, 90].map((dias) => {
    const entradas = ent(`ent_${dias}`);
    const saidas = N(fr[`sai_${dias}`]);
    return { dias, entradas, saidas, saldo: entradas - saidas };
  });

  const dre = {
    mes: { receitas: ent('rec_mes'), despesas: N(fr.desp_mes), resultado: ent('rec_mes') - N(fr.desp_mes) },
    ano: { receitas: ent('rec_ano'), despesas: N(fr.desp_ano), resultado: ent('rec_ano') - N(fr.desp_ano) },
  };

  const inadimplencia = {
    ate_30: N(fr.aging1) + N(inst.aging1),
    de_31_60: N(fr.aging2) + N(inst.aging2),
    mais_60: N(fr.aging3) + N(inst.aging3),
  };
  (inadimplencia as any).total = inadimplencia.ate_30 + inadimplencia.de_31_60 + inadimplencia.mais_60;

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
router.patch('/:id/pay', async (req: Request, res: Response) => {
  const [result] = await db.query(
    "UPDATE financial_records SET status = 'pago', paid_at = NOW() WHERE id = ? AND user_id = ?",
    [req.params.id, req.user!.id]
  ) as any;
  if (!result.affectedRows) { res.status(404).json({ error: 'Lançamento não encontrado' }); return; }
  res.json({ success: true, id: Number(req.params.id), status: 'pago' });
});

// ── PUT /api/financial/:id ──────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT id FROM financial_records WHERE id = ? AND user_id = ?', [id, req.user!.id]) as any;
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

// ── GET /api/financial/a-receber — TUDO a receber, de todas as frentes ───────
// Uma lista só: lançamentos, parcelas de propostas, parcelas de contratos,
// dativas e correspondente. Cada linha diz de onde veio (fonte) para o front
// chamar o endpoint certo de recebimento. Valores sempre numéricos.
router.get('/a-receber', async (_req: Request, res: Response) => {
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

// ── GET /api/financial/projecao — fluxo de caixa 30/60/90 dias ──────────────
// Entradas previstas (parcelas + receitas + dativas + correspondente) − saídas
// previstas (despesas pendentes + repasses a pagar), por janela e acumulado.
router.get('/projecao', async (_req: Request, res: Response) => {
  const janela = async (de: number, ate: number) => {
    const [[e]] = await db.query(`
      SELECT COALESCE((SELECT SUM(valor) FROM installments
               WHERE status IN ('pendente','em_processamento')
                 AND due_date BETWEEN DATE_ADD(CURDATE(), INTERVAL ? DAY) AND DATE_ADD(CURDATE(), INTERVAL ? DAY)),0)
           + COALESCE((SELECT SUM(valor) FROM financial_records
               WHERE tipo='receita' AND status='pendente'
                 AND due_date BETWEEN DATE_ADD(CURDATE(), INTERVAL ? DAY) AND DATE_ADD(CURDATE(), INTERVAL ? DAY)),0)
           + COALESCE((SELECT SUM(value) FROM dative_payments
               WHERE status='previsto'
                 AND expected_date BETWEEN DATE_ADD(CURDATE(), INTERVAL ? DAY) AND DATE_ADD(CURDATE(), INTERVAL ? DAY)),0)
           + COALESCE((SELECT SUM(value) FROM correspondent_hearings
               WHERE status IN ('agendada','realizada','faturada')
                 AND due_date BETWEEN DATE_ADD(CURDATE(), INTERVAL ? DAY) AND DATE_ADD(CURDATE(), INTERVAL ? DAY)),0) AS entradas,
             COALESCE((SELECT SUM(valor) FROM financial_records
               WHERE tipo='despesa' AND status='pendente'
                 AND due_date BETWEEN DATE_ADD(CURDATE(), INTERVAL ? DAY) AND DATE_ADD(CURDATE(), INTERVAL ? DAY)),0)
           + COALESCE((SELECT SUM(valor) FROM repasses
               WHERE status IN ('pendente','processando')
                 AND data_vencimento BETWEEN DATE_ADD(CURDATE(), INTERVAL ? DAY) AND DATE_ADD(CURDATE(), INTERVAL ? DAY)),0) AS saidas
    `, [de, ate, de, ate, de, ate, de, ate, de, ate, de, ate]) as any;
    return { entradas: Number(e.entradas), saidas: Number(e.saidas), saldo: Number(e.entradas) - Number(e.saidas) };
  };
  const [d30, d60, d90] = [await janela(0, 30), await janela(31, 60), await janela(61, 90)];
  res.json({
    d30, d60, d90,
    acumulado: { d30: d30.saldo, d60: d30.saldo + d60.saldo, d90: d30.saldo + d60.saldo + d90.saldo },
  });
});

// ── GET /api/financial/dre?month=YYYY-MM — fechamento do mês (contador) ─────
router.get('/dre', async (req: Request, res: Response) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : new Date().toISOString().slice(0, 7);
  const [[rec]] = await db.query(`
    SELECT
      COALESCE((SELECT SUM(valor) FROM installments WHERE status='pago' AND DATE_FORMAT(paid_at,'%Y-%m') = ?),0) AS parcelas_contratos,
      COALESCE((SELECT SUM(valor) FROM financial_records WHERE tipo='receita' AND status='pago'
        AND DATE_FORMAT(COALESCE(paid_at, due_date),'%Y-%m') = ? AND description LIKE 'Entrada parceria%'),0) AS entradas_parceria,
      COALESCE((SELECT SUM(valor) FROM financial_records WHERE tipo='receita' AND status='pago'
        AND DATE_FORMAT(COALESCE(paid_at, due_date),'%Y-%m') = ? AND description NOT LIKE 'Entrada parceria%'),0) AS demais_receitas,
      COALESCE((SELECT SUM(value) FROM dative_payments WHERE status='recebido'
        AND DATE_FORMAT(received_date,'%Y-%m') = ?),0) AS dativo,
      COALESCE((SELECT SUM(value) FROM correspondent_hearings WHERE status='paga'
        AND DATE_FORMAT(paid_at,'%Y-%m') = ?),0) AS correspondente
  `, [month, month, month, month, month]) as any;
  const [despesas] = await db.query(`
    SELECT COALESCE(cost_center, 'Sem categoria') AS categoria, SUM(valor) AS total
      FROM financial_records
     WHERE tipo='despesa' AND status='pago' AND DATE_FORMAT(COALESCE(paid_at, due_date),'%Y-%m') = ?
     GROUP BY COALESCE(cost_center, 'Sem categoria') ORDER BY total DESC`, [month]) as any;
  const [repasses] = await db.query(`
    SELECT COALESCE(SUM(valor),0) AS total FROM repasses
     WHERE status='repassado' AND DATE_FORMAT(data_repasse,'%Y-%m') = ?`, [month]) as any;

  const receitas = {
    parcelas_contratos: Number(rec.parcelas_contratos),
    entradas_parceria: Number(rec.entradas_parceria),
    dativo: Number(rec.dativo),
    correspondente: Number(rec.correspondente),
    demais_receitas: Number(rec.demais_receitas),
  };
  const receita_total = receitas.parcelas_contratos + receitas.entradas_parceria + receitas.dativo + receitas.correspondente + receitas.demais_receitas;
  const despesa_total = despesas.reduce((s: number, d: any) => s + Number(d.total), 0);
  const repasses_pagos = Number(repasses[0]?.total || 0);
  res.json({
    month, receitas, receita_total, despesas, despesa_total, repasses_pagos,
    resultado: receita_total - despesa_total - repasses_pagos,
  });
});

// ── GET /api/financial/receita-origem?month — receita recebida por área/parceria
router.get('/receita-origem', async (req: Request, res: Response) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : new Date().toISOString().slice(0, 7);
  const [porArea] = await db.query(`
    SELECT COALESCE(c.legal_area, 'sem área') AS area, SUM(i.valor) AS total
      FROM installments i LEFT JOIN cases c ON c.id = i.case_id
     WHERE i.status='pago' AND DATE_FORMAT(i.paid_at,'%Y-%m') = ?
     GROUP BY COALESCE(c.legal_area, 'sem área') ORDER BY total DESC`, [month]) as any;
  const [porParceiro] = await db.query(`
    SELECT p.name AS parceiro,
           COALESCE(SUM(i.valor),0) AS recebido,
           COALESCE((SELECT SUM(r.valor) FROM repasses r JOIN cases c2 ON c2.id = r.case_id
              WHERE c2.partner_id = p.id AND r.status='repassado' AND DATE_FORMAT(r.data_repasse,'%Y-%m') = ?),0) AS repassado
      FROM partners p
      LEFT JOIN cases c ON c.partner_id = p.id
      LEFT JOIN installments i ON i.case_id = c.id AND i.status='pago' AND DATE_FORMAT(i.paid_at,'%Y-%m') = ?
     GROUP BY p.id, p.name HAVING recebido > 0 OR repassado > 0`, [month, month]) as any;
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
