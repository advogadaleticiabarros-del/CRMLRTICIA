import { Router, Request, Response } from 'express';
import { db } from '../config/database';

const router = Router();

const STATUSES = ['novo', 'contatado', 'qualificado', 'reuniao_marcada', 'convertido', 'perdido'];
const AREAS = ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro'];

// ── GET /api/leads/board — funil agrupado por status (kanban) ───────────────
router.get('/board', async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const [rows] = await db.query(
    `SELECT id, name, email, phone, source, legal_area, status, created_at
     FROM leads
     WHERE user_id = ? AND status NOT IN ('convertido','perdido')
     ORDER BY created_at DESC`,
    [userId]
  ) as any;

  const board: Record<string, any[]> = {
    novo: [], contatado: [], qualificado: [], reuniao_marcada: [],
  };
  for (const lead of rows) {
    (board[lead.status] ??= []).push(lead);
  }

  res.json(board);
});

// ── GET /api/leads — lista com filtros e paginação ──────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const search = (req.query.search as string)?.trim();
  const status = req.query.status as string;
  const area   = req.query.area as string;
  const page   = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const params: any[] = [];

  if (search) {
    where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (status && STATUSES.includes(status)) { where.push('status = ?'); params.push(status); }
  if (area && AREAS.includes(area))         { where.push('legal_area = ?'); params.push(area); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM leads ${whereSql}`, params
  ) as any;

  const [rows] = await db.query(
    `SELECT id, name, email, phone, source, legal_area, status, created_at
     FROM leads ${whereSql}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as any;

  res.json({ data: rows, total, page, limit, pages: Math.ceil(total / limit) });
});

// ── GET /api/leads/:id ──────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT l.*, c.name AS client_name, u.name AS responsavel
     FROM leads l
     LEFT JOIN clients c ON c.id = l.client_id
     LEFT JOIN users u   ON u.id = l.user_id
     WHERE l.id = ?`,
    [req.params.id]
  ) as any;

  if (!rows.length) {
    res.status(404).json({ error: 'Lead não encontrado' });
    return;
  }
  res.json(rows[0]);
});

// ── POST /api/leads ─────────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { name, email, phone, source, legal_area, status, notes, client_id } = req.body;

  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'O nome é obrigatório' });
    return;
  }

  const [result] = await db.query(
    `INSERT INTO leads (user_id, client_id, name, email, phone, source, legal_area, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user!.id,
      client_id ?? null,
      name.trim(),
      email ?? null,
      phone ?? null,
      source ?? null,
      AREAS.includes(legal_area) ? legal_area : null,
      STATUSES.includes(status) ? status : 'novo',
      notes ?? null,
    ]
  ) as any;

  const [rows] = await db.query('SELECT * FROM leads WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── PUT /api/leads/:id ──────────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const body = req.body;

  const [existing] = await db.query('SELECT id FROM leads WHERE id = ?', [id]) as any;
  if (!existing.length) {
    res.status(404).json({ error: 'Lead não encontrado' });
    return;
  }

  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };

  setIf('name', body.name?.trim?.());
  setIf('email', body.email);
  setIf('phone', body.phone);
  setIf('source', body.source);
  setIf('legal_area', body.legal_area, AREAS.includes(body.legal_area));
  setIf('status', body.status, STATUSES.includes(body.status));
  setIf('notes', body.notes);

  if (!fields.length) {
    res.status(400).json({ error: 'Nenhum campo válido para atualizar' });
    return;
  }

  params.push(id);
  await db.query(`UPDATE leads SET ${fields.join(', ')} WHERE id = ?`, params);

  const [rows] = await db.query('SELECT * FROM leads WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

// ── PATCH /api/leads/:id/status — mover no funil ────────────────────────────
router.patch('/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!STATUSES.includes(status)) {
    res.status(400).json({ error: `status deve ser um de: ${STATUSES.join(', ')}` });
    return;
  }

  const [result] = await db.query('UPDATE leads SET status = ? WHERE id = ?', [status, id]) as any;
  if (!result.affectedRows) {
    res.status(404).json({ error: 'Lead não encontrado' });
    return;
  }

  res.json({ success: true, id: Number(id), status });
});

// ── POST /api/leads/:id/convert-client — converte lead em cliente ───────────
router.post('/:id/convert-client', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { tipo } = req.body;

  const [rows] = await db.query('SELECT * FROM leads WHERE id = ?', [id]) as any;
  if (!rows.length) {
    res.status(404).json({ error: 'Lead não encontrado' });
    return;
  }
  const lead = rows[0];

  if (lead.client_id) {
    res.status(409).json({ error: 'Lead já vinculado a um cliente', client_id: lead.client_id });
    return;
  }

  const [result] = await db.query(
    `INSERT INTO clients (name, tipo, email, phone, status, created_by, notes)
     VALUES (?, ?, ?, ?, 'ativo', ?, ?)`,
    [lead.name, tipo === 'PJ' ? 'PJ' : 'PF', lead.email, lead.phone, lead.user_id, lead.notes]
  ) as any;

  await db.query(
    "UPDATE leads SET client_id = ?, status = 'convertido' WHERE id = ?",
    [result.insertId, id]
  );

  res.status(201).json({ success: true, client_id: result.insertId });
});

export default router;
