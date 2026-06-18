import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { deadlineCounterService } from '../services/DeadlineCounterService';

const router = Router();

const STATUSES = ['pendente', 'em_andamento', 'concluida', 'cancelada'];
const PRIORITIES = ['baixa', 'media', 'alta', 'critica'];

const STATUS_LABEL_SQL = `
  CASE
    WHEN t.due_date IS NULL THEN 'normal'
    WHEN t.due_date < NOW() THEN 'vencido'
    WHEN TIMESTAMPDIFF(HOUR, NOW(), t.due_date) <= 24 THEN 'urgente'
    WHEN TIMESTAMPDIFF(DAY, NOW(), t.due_date) <= 3 THEN 'atencao'
    ELSE 'normal'
  END`;

// ── GET /api/tasks ──────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const status   = req.query.status as string;
  const priority = req.query.priority as string;
  const clientId = req.query.client_id as string;
  const page     = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit    = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
  const offset   = (page - 1) * limit;

  const where: string[] = ['t.user_id = ?'];
  const params: any[] = [req.user!.id];
  if (status && STATUSES.includes(status))       { where.push('t.status = ?'); params.push(status); }
  if (priority && PRIORITIES.includes(priority)) { where.push('t.priority = ?'); params.push(priority); }
  if (clientId) { where.push('t.client_id = ?'); params.push(clientId); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM tasks t ${whereSql}`, params) as any;

  const [rows] = await db.query(
    `SELECT t.id, t.title, t.due_date, t.priority, t.status, t.client_id,
            cl.name AS client_name,
            TIMESTAMPDIFF(DAY, NOW(), t.due_date) AS days_remaining,
            ${STATUS_LABEL_SQL} AS status_label
     FROM tasks t
     LEFT JOIN clients cl ON cl.id = t.client_id
     ${whereSql}
     ORDER BY FIELD(t.priority, 'critica','alta','media','baixa'), t.due_date ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as any;

  res.json({ data: rows, total, page, limit, pages: Math.ceil(total / limit) });
});

// ── POST /api/tasks ─────────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { title, description, due_date, priority, client_id, case_id } = req.body;
  if (!title || !String(title).trim()) { res.status(400).json({ error: 'O título é obrigatório' }); return; }

  const [result] = await db.query(
    `INSERT INTO tasks (user_id, client_id, case_id, title, description, due_date, priority, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente')`,
    [req.user!.id, client_id ?? null, case_id ?? null, title.trim(), description ?? null,
     due_date || null, PRIORITIES.includes(priority) ? priority : 'media']
  ) as any;

  if (due_date) {
    await deadlineCounterService.upsert({ taskId: result.insertId, dueDate: new Date(due_date) });
  }

  const [rows] = await db.query('SELECT * FROM tasks WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── PUT /api/tasks/:id ──────────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT id FROM tasks WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Tarefa não encontrada' }); return; }

  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };
  setIf('title', req.body.title?.trim?.());
  setIf('description', req.body.description);
  setIf('due_date', req.body.due_date);
  setIf('priority', req.body.priority, PRIORITIES.includes(req.body.priority));
  setIf('status', req.body.status, STATUSES.includes(req.body.status));

  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido para atualizar' }); return; }
  params.push(id);
  await db.query(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, params);

  if (req.body.due_date) {
    await deadlineCounterService.upsert({ taskId: Number(id), dueDate: new Date(req.body.due_date) });
  }

  const [rows] = await db.query('SELECT * FROM tasks WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

// ── PATCH /api/tasks/:id/status ─────────────────────────────────────────────
router.patch('/:id/status', async (req: Request, res: Response) => {
  const { status } = req.body;
  if (!STATUSES.includes(status)) {
    res.status(400).json({ error: `status deve ser um de: ${STATUSES.join(', ')}` }); return;
  }
  const [result] = await db.query('UPDATE tasks SET status = ? WHERE id = ?', [status, req.params.id]) as any;
  if (!result.affectedRows) { res.status(404).json({ error: 'Tarefa não encontrada' }); return; }
  res.json({ success: true, id: Number(req.params.id), status });
});

export default router;
