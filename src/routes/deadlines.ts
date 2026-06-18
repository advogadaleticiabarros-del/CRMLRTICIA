import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { deadlineCounterService } from '../services/DeadlineCounterService';

const router = Router();

const STATUSES = ['pendente', 'cumprido', 'cancelado'];
const PRIORITIES = ['baixa', 'media', 'alta', 'critica'];

// Expressão SQL que calcula o rótulo da contagem regressiva ao vivo.
const STATUS_LABEL_SQL = `
  CASE
    WHEN d.status <> 'pendente' THEN d.status
    WHEN d.deadline_date < NOW() THEN 'vencido'
    WHEN TIMESTAMPDIFF(HOUR, NOW(), d.deadline_date) <= 24 THEN 'urgente'
    WHEN TIMESTAMPDIFF(DAY, NOW(), d.deadline_date) <= 3 THEN 'atencao'
    ELSE 'normal'
  END`;

// ── GET /api/deadlines — lista com contagem regressiva ──────────────────────
router.get('/', async (req: Request, res: Response) => {
  const status  = req.query.status as string;
  const caseId  = req.query.case_id as string;
  const page    = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit   = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
  const offset  = (page - 1) * limit;

  const where: string[] = ['d.user_id = ?'];
  const params: any[] = [req.user!.id];
  if (status && STATUSES.includes(status)) { where.push('d.status = ?'); params.push(status); }
  if (caseId) { where.push('d.case_id = ?'); params.push(caseId); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM deadlines d ${whereSql}`, params) as any;

  const [rows] = await db.query(
    `SELECT d.id, d.description, d.deadline_date, d.priority, d.status, d.case_id,
            c.case_number, cl.name AS client_name,
            TIMESTAMPDIFF(DAY, NOW(), d.deadline_date) AS days_remaining,
            ${STATUS_LABEL_SQL} AS status_label
     FROM deadlines d
     LEFT JOIN cases c ON c.id = d.case_id
     LEFT JOIN clients cl ON cl.id = c.client_id
     ${whereSql}
     ORDER BY d.deadline_date ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as any;

  res.json({ data: rows, total, page, limit, pages: Math.ceil(total / limit) });
});

// ── POST /api/deadlines — criar prazo ───────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { case_id, client_id, description, deadline_date, priority } = req.body;
  if (!case_id) { res.status(400).json({ error: 'case_id é obrigatório' }); return; }
  if (!description || !String(description).trim()) { res.status(400).json({ error: 'A descrição é obrigatória' }); return; }
  if (!deadline_date) { res.status(400).json({ error: 'deadline_date é obrigatório' }); return; }

  // herda o cliente do processo se não informado
  let clientId = client_id ?? null;
  if (!clientId) {
    const [c] = await db.query('SELECT client_id FROM cases WHERE id = ?', [case_id]) as any;
    clientId = c[0]?.client_id ?? null;
  }

  const [result] = await db.query(
    `INSERT INTO deadlines (user_id, client_id, case_id, description, deadline_date, priority, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pendente')`,
    [req.user!.id, clientId, case_id, description.trim(), deadline_date,
     PRIORITIES.includes(priority) ? priority : 'alta']
  ) as any;

  await deadlineCounterService.upsert({ deadlineId: result.insertId, dueDate: new Date(deadline_date) });

  const [rows] = await db.query('SELECT * FROM deadlines WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── PUT /api/deadlines/:id ──────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT id FROM deadlines WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Prazo não encontrado' }); return; }

  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };
  setIf('description', req.body.description?.trim?.());
  setIf('deadline_date', req.body.deadline_date);
  setIf('priority', req.body.priority, PRIORITIES.includes(req.body.priority));
  setIf('status', req.body.status, STATUSES.includes(req.body.status));

  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido para atualizar' }); return; }
  params.push(id);
  await db.query(`UPDATE deadlines SET ${fields.join(', ')} WHERE id = ?`, params);

  if (req.body.deadline_date) {
    await deadlineCounterService.upsert({ deadlineId: Number(id), dueDate: new Date(req.body.deadline_date) });
  }

  const [rows] = await db.query('SELECT * FROM deadlines WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

// ── PATCH /api/deadlines/:id/status — cumprir/cancelar ──────────────────────
router.patch('/:id/status', async (req: Request, res: Response) => {
  const { status } = req.body;
  if (!STATUSES.includes(status)) {
    res.status(400).json({ error: `status deve ser um de: ${STATUSES.join(', ')}` }); return;
  }
  const [result] = await db.query('UPDATE deadlines SET status = ? WHERE id = ?', [status, req.params.id]) as any;
  if (!result.affectedRows) { res.status(404).json({ error: 'Prazo não encontrado' }); return; }
  res.json({ success: true, id: Number(req.params.id), status });
});

export default router;
