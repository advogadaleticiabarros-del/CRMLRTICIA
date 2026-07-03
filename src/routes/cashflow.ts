import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../config/database';
import { getMonthlyCashflow, CATEGORY_PT } from '../services/cashflowService';

const router = Router();

const TYPES = ['entrada', 'saida'];

function addMonthsStr(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

// ── GET /api/cashflow/monthly?from=YYYY-MM&months=24 — visão consolidada ─────
router.get('/monthly', async (req: Request, res: Response) => {
  const now = new Date();
  const from = (req.query.from as string) || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const months = Math.min(36, Math.max(1, parseInt(req.query.months as string) || 24));
  const data = await getMonthlyCashflow(from, months);
  res.json(data);
});

// ── GET /api/cashflow/categories — rótulos das categorias ───────────────────
router.get('/categories', (_req: Request, res: Response) => {
  res.json(CATEGORY_PT);
});

// ── GET /api/cashflow — lista os lançamentos manuais ────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const type = req.query.type as string;
  const from = req.query.from as string;
  const to = req.query.to as string;
  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (type && TYPES.includes(type)) { where.push('type = ?'); params.push(type); }
  if (from) { where.push('due_date >= ?'); params.push(from); }
  if (to) { where.push('due_date <= ?'); params.push(to); }
  const escopo = req.query.escopo as string;
  if (escopo === 'empresa' || escopo === 'pessoal') { where.push('escopo = ?'); params.push(escopo); }

  const [rows] = await db.query(
    `SELECT * FROM cashflow_entries WHERE ${where.join(' AND ')} ORDER BY due_date ASC LIMIT 500`, params
  ) as any;
  res.json(rows);
});

// ── GET /api/cashflow/opcoes — pagadoras e bancos já usados (sugestões) ──────
router.get('/opcoes', async (_req: Request, res: Response) => {
  const [pag] = await db.query("SELECT DISTINCT pagador FROM cashflow_entries WHERE pagador IS NOT NULL AND pagador <> '' ORDER BY pagador") as any;
  const [ban] = await db.query("SELECT DISTINCT banco FROM cashflow_entries WHERE banco IS NOT NULL AND banco <> '' ORDER BY banco") as any;
  res.json({ pagadores: pag.map((r: any) => r.pagador), bancos: ban.map((r: any) => r.banco) });
});

// ── POST /api/cashflow — cria lançamento (única ou mensal por N meses) ───────
router.post('/', async (req: Request, res: Response) => {
  const { type, category, description, amount, due_date, recurrence, occurrences, client_id, case_id, cost_center, notes, pagador, banco, escopo } = req.body;
  if (!TYPES.includes(type)) { res.status(400).json({ error: "type deve ser 'entrada' ou 'saida'" }); return; }
  if (!category) { res.status(400).json({ error: 'category é obrigatória' }); return; }
  if (!description || !String(description).trim()) { res.status(400).json({ error: 'A descrição é obrigatória' }); return; }
  if (!due_date) { res.status(400).json({ error: 'due_date é obrigatória' }); return; }

  const valor = Number(amount) || 0;
  const total = recurrence === 'mensal' ? Math.min(120, Math.max(1, parseInt(occurrences) || 1)) : 1;
  const group = total > 1 ? crypto.randomUUID() : null;
  const esc = escopo === 'pessoal' ? 'pessoal' : 'empresa';
  const pag = (pagador && String(pagador).trim()) || null;
  const ban = (banco && String(banco).trim()) || null;

  const ids: number[] = [];
  for (let i = 0; i < total; i++) {
    const due = i === 0 ? due_date : addMonthsStr(due_date, i);
    const [r] = await db.query(
      `INSERT INTO cashflow_entries
         (user_id, type, category, description, amount, due_date, status, client_id, case_id, cost_center, recurrence_group, installment_no, installment_total, notes, pagador, banco, escopo)
       VALUES (?, ?, ?, ?, ?, ?, 'previsto', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user!.id, type, category, description.trim(), valor, due,
       client_id ?? null, case_id ?? null, cost_center ?? null, group, i + 1, total, notes ?? null, pag, ban, esc]
    ) as any;
    ids.push(r.insertId);
  }
  res.status(201).json({ success: true, created: ids.length, recurrence_group: group });
});

// ── PATCH /api/cashflow/:id/pay — marca como realizado ──────────────────────
router.patch('/:id/pay', async (req: Request, res: Response) => {
  const paidAt = req.body?.paid_at || new Date().toISOString().split('T')[0];
  const [r] = await db.query(
    "UPDATE cashflow_entries SET status = 'realizado', paid_at = ? WHERE id = ?", [paidAt, req.params.id]
  ) as any;
  if (!r.affectedRows) { res.status(404).json({ error: 'Lançamento não encontrado' }); return; }
  res.json({ success: true, id: Number(req.params.id), status: 'realizado' });
});

// ── PUT /api/cashflow/:id ───────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT id FROM cashflow_entries WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Lançamento não encontrado' }); return; }
  const fields: string[] = []; const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => { if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); } };
  setIf('description', req.body.description?.trim?.());
  setIf('amount', req.body.amount !== undefined ? Number(req.body.amount) : undefined);
  setIf('due_date', req.body.due_date);
  setIf('category', req.body.category);
  setIf('cost_center', req.body.cost_center);
  setIf('pagador', req.body.pagador);
  setIf('banco', req.body.banco);
  setIf('escopo', req.body.escopo, req.body.escopo === 'empresa' || req.body.escopo === 'pessoal');
  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido' }); return; }
  params.push(id);
  await db.query(`UPDATE cashflow_entries SET ${fields.join(', ')} WHERE id = ?`, params);
  const [rows] = await db.query('SELECT * FROM cashflow_entries WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

// ── DELETE /api/cashflow/:id  |  /group/:group ──────────────────────────────
router.delete('/group/:group', async (req: Request, res: Response) => {
  const [r] = await db.query('DELETE FROM cashflow_entries WHERE recurrence_group = ?', [req.params.group]) as any;
  res.json({ success: true, deleted: r.affectedRows });
});
router.delete('/:id', async (req: Request, res: Response) => {
  const [r] = await db.query('DELETE FROM cashflow_entries WHERE id = ?', [req.params.id]) as any;
  if (!r.affectedRows) { res.status(404).json({ error: 'Lançamento não encontrado' }); return; }
  res.json({ success: true, id: Number(req.params.id) });
});

export default router;
