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

// ── GET /api/financial/summary — KPIs rápidos ───────────────────────────────
router.get('/summary', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [[fr]] = await db.query(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo='receita' AND status='pendente' THEN valor END),0) AS receita_prevista,
      COALESCE(SUM(CASE WHEN tipo='receita' AND status='pago'     THEN valor END),0) AS receita_realizada,
      COALESCE(SUM(CASE WHEN tipo='despesa' AND status='pendente' THEN valor END),0) AS despesa_prevista,
      COALESCE(SUM(CASE WHEN tipo='despesa' AND status='pago'     THEN valor END),0) AS despesa_paga
    FROM financial_records WHERE user_id = ?`, [userId]) as any;

  const [[inst]] = await db.query(`
    SELECT
      COALESCE(SUM(CASE WHEN i.status='pendente' THEN i.valor END),0) AS parcelas_a_receber,
      COALESCE(SUM(CASE WHEN i.status='pago'     THEN i.valor END),0) AS parcelas_recebidas,
      COALESCE(SUM(CASE WHEN i.status='pendente' AND i.due_date < CURDATE() THEN i.valor END),0) AS parcelas_vencidas
    FROM installments i`, []) as any;

  res.json({
    receita_prevista: Number(fr.receita_prevista) + Number(inst.parcelas_a_receber),
    receita_realizada: Number(fr.receita_realizada) + Number(inst.parcelas_recebidas),
    despesa_prevista: fr.despesa_prevista,
    despesa_paga: fr.despesa_paga,
    saldo_previsto: (Number(fr.receita_prevista) + Number(inst.parcelas_a_receber)) - Number(fr.despesa_prevista),
    saldo_realizado: (Number(fr.receita_realizada) + Number(inst.parcelas_recebidas)) - Number(fr.despesa_paga),
    inadimplencia: inst.parcelas_vencidas,
  });
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
