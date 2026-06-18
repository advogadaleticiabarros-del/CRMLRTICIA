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
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM financial_records fr ${whereSql}`, params) as any;

  const [rows] = await db.query(
    `SELECT fr.id, fr.tipo, fr.description, fr.valor, fr.status, fr.due_date, fr.paid_at,
            fr.cost_center, fr.recurrence_type, cl.name AS client_name
     FROM financial_records fr
     LEFT JOIN clients cl ON cl.id = fr.client_id
     ${whereSql} ORDER BY fr.due_date DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as any;

  res.json({ data: rows, total, page, limit, pages: Math.ceil(total / limit) });
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

// ── POST /api/financial — criar lançamento ──────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { tipo, description, valor, due_date, status, cost_center, recurrence_type, client_id, case_id } = req.body;
  if (!TIPOS.includes(tipo)) { res.status(400).json({ error: "tipo deve ser 'receita' ou 'despesa'" }); return; }
  if (!description || !String(description).trim()) { res.status(400).json({ error: 'A descrição é obrigatória' }); return; }

  const recur = RECURRENCES.includes(recurrence_type) ? recurrence_type : null;
  const nextDue = recur && due_date ? addMonthsStr(due_date, RECUR_MONTHS[recur]) : null;

  const [result] = await db.query(
    `INSERT INTO financial_records
       (user_id, client_id, case_id, tipo, description, valor, status, due_date, cost_center, recurrence_type, next_due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user!.id, client_id ?? null, case_id ?? null, tipo, description.trim(),
     Number(valor) || 0, STATUSES.includes(status) ? status : 'pendente',
     due_date || null, cost_center ?? null, recur, nextDue]
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
  res.json({ success: true, id: Number(req.params.id), status: 'pago' });
});

export default router;
