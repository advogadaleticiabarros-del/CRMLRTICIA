import { Router, Request, Response } from 'express';
import { db } from '../config/database';

const router = Router();

const AREAS = ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro'];
const PHASES = ['inicial', 'instrucao', 'sentenca', 'recurso', 'execucao', 'encerrado'];
const STATUSES = ['ativo', 'suspenso', 'encerrado'];

// ── GET /api/cases — lista com filtros e paginação ──────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const search   = (req.query.search as string)?.trim();
  const status   = req.query.status as string;
  const area     = req.query.area as string;
  const clientId = req.query.client_id as string;
  const page     = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit    = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset   = (page - 1) * limit;

  const where: string[] = [];
  const params: any[] = [];
  // Visibilidade por papel: admin/advogado veem todos; estagiário/parceiro só os atribuídos.
  const role = req.user!.role;
  if (role === 'estagiario' || role === 'parceiro') {
    where.push('c.id IN (SELECT case_id FROM case_collaborators WHERE user_id = ?)');
    params.push(req.user!.id);
  }
  if (search)   { where.push('(c.title LIKE ? OR c.case_number LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (status && STATUSES.includes(status)) { where.push('c.status = ?'); params.push(status); }
  if (area && AREAS.includes(area))         { where.push('c.legal_area = ?'); params.push(area); }
  if (clientId) { where.push('c.client_id = ?'); params.push(clientId); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM cases c ${whereSql}`, params) as any;

  const [rows] = await db.query(
    `SELECT c.id, c.case_number, c.title, c.legal_area, c.phase, c.status, c.created_at, cl.name AS client_name
     FROM cases c LEFT JOIN clients cl ON cl.id = c.client_id
     ${whereSql} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as any;

  res.json({ data: rows, total, page, limit, pages: Math.ceil(total / limit) });
});

// ── GET /api/cases/:id — detalhe com movimentações e resumo ─────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [rows] = await db.query(
    `SELECT c.*, cl.name AS client_name FROM cases c
     LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?`, [id]
  ) as any;
  if (!rows.length) { res.status(404).json({ error: 'Processo não encontrado' }); return; }

  const [movements] = await db.query(
    'SELECT id, description, movement_date, created_at FROM case_movements WHERE case_id = ? ORDER BY COALESCE(movement_date, created_at) DESC LIMIT 50',
    [id]
  ) as any;

  const [[resumo]] = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM deadlines WHERE case_id = ? AND status = 'pendente') AS prazos_pendentes,
      (SELECT COUNT(*) FROM legal_pieces WHERE case_id = ? AND status NOT IN ('protocolado','cancelado')) AS pecas_pendentes
  `, [id, id]) as any;

  res.json({ ...rows[0], movements, resumo });
});

// ── POST /api/cases — criar ─────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { client_id, case_number, title, legal_area, phase, status, description } = req.body;
  if (!client_id) { res.status(400).json({ error: 'client_id é obrigatório' }); return; }
  if (!title || !String(title).trim()) { res.status(400).json({ error: 'O título é obrigatório' }); return; }

  const [result] = await db.query(
    `INSERT INTO cases (user_id, client_id, case_number, title, legal_area, phase, status, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user!.id, client_id, case_number ?? null, title.trim(),
      AREAS.includes(legal_area) ? legal_area : 'outro',
      PHASES.includes(phase) ? phase : 'inicial',
      STATUSES.includes(status) ? status : 'ativo',
      description ?? null,
    ]
  ) as any;

  const [rows] = await db.query('SELECT * FROM cases WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── PUT /api/cases/:id ──────────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT id FROM cases WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Processo não encontrado' }); return; }

  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };
  setIf('title', req.body.title?.trim?.());
  setIf('case_number', req.body.case_number);
  setIf('legal_area', req.body.legal_area, AREAS.includes(req.body.legal_area));
  setIf('phase', req.body.phase, PHASES.includes(req.body.phase));
  setIf('status', req.body.status, STATUSES.includes(req.body.status));
  setIf('description', req.body.description);

  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido para atualizar' }); return; }
  params.push(id);
  await db.query(`UPDATE cases SET ${fields.join(', ')} WHERE id = ?`, params);

  const [rows] = await db.query('SELECT * FROM cases WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

// ── GET /api/cases/:id/collaborators — quem trabalha no processo ────────────
router.get('/:id/collaborators', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT cc.id, cc.user_id, cc.role, cc.commission_percent, u.name, u.role AS user_role
     FROM case_collaborators cc JOIN users u ON u.id = cc.user_id
     WHERE cc.case_id = ? ORDER BY cc.role, u.name`,
    [req.params.id]
  ) as any;
  res.json(rows);
});

// ── POST /api/cases/:id/collaborators — atribuir estagiário/parceiro ────────
router.post('/:id/collaborators', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { user_id, role, commission_percent } = req.body;
  if (!user_id) { res.status(400).json({ error: 'user_id é obrigatório' }); return; }

  const [u] = await db.query("SELECT role, commission_percent FROM users WHERE id = ?", [user_id]) as any;
  if (!u.length) { res.status(404).json({ error: 'Usuário não encontrado' }); return; }

  // repasse: usa o informado, ou o padrão do parceiro
  const commission = commission_percent ?? (u[0].role === 'parceiro' ? u[0].commission_percent : null);

  await db.query(
    `INSERT INTO case_collaborators (case_id, user_id, role, commission_percent)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE role = VALUES(role), commission_percent = VALUES(commission_percent)`,
    [id, user_id, role === 'responsavel' ? 'responsavel' : 'colaborador', commission]
  );
  res.status(201).json({ success: true });
});

// ── DELETE /api/cases/:id/collaborators/:userId ─────────────────────────────
router.delete('/:id/collaborators/:userId', async (req: Request, res: Response) => {
  await db.query('DELETE FROM case_collaborators WHERE case_id = ? AND user_id = ?', [req.params.id, req.params.userId]);
  res.json({ success: true });
});

// ── POST /api/cases/:id/movements — registrar movimentação ──────────────────
router.post('/:id/movements', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { description, movement_date } = req.body;
  if (!description || !String(description).trim()) {
    res.status(400).json({ error: 'A descrição da movimentação é obrigatória' }); return;
  }

  const [cases] = await db.query('SELECT client_id FROM cases WHERE id = ?', [id]) as any;
  if (!cases.length) { res.status(404).json({ error: 'Processo não encontrado' }); return; }

  const [result] = await db.query(
    'INSERT INTO case_movements (case_id, client_id, description, movement_date) VALUES (?, ?, ?, ?)',
    [id, cases[0].client_id, description.trim(), movement_date || null]
  ) as any;

  const [rows] = await db.query('SELECT * FROM case_movements WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

export default router;
