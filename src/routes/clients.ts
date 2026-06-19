import { Router, Request, Response } from 'express';
import { db } from '../config/database';

const router = Router();

const TIPOS = ['PF', 'PJ'];
const STATUSES = ['ativo', 'inativo', 'prospecto'];

// ── GET /api/clients — lista com busca e paginação ──────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const search = (req.query.search as string)?.trim();
  const status = req.query.status as string;
  const tipo   = req.query.tipo as string;
  const page   = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const params: any[] = [];

  if (search) {
    where.push('(name LIKE ? OR cpf_cnpj LIKE ? OR email LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (status && STATUSES.includes(status)) { where.push('status = ?'); params.push(status); }
  if (tipo && TIPOS.includes(tipo))        { where.push('tipo = ?');   params.push(tipo); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM clients ${whereSql}`,
    params
  ) as any;

  const [rows] = await db.query(
    `SELECT id, name, tipo, cpf_cnpj, email, phone, status, is_dative, created_at
     FROM clients ${whereSql}
     ORDER BY name ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as any;

  res.json({ data: rows, total, page, limit, pages: Math.ceil(total / limit) });
});

// ── GET /api/clients/:id — detalhe com resumo ───────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  const [rows] = await db.query('SELECT * FROM clients WHERE id = ?', [id]) as any;
  if (!rows.length) {
    res.status(404).json({ error: 'Cliente não encontrado' });
    return;
  }

  const [[resumo]] = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM cases WHERE client_id = ? AND status = 'ativo')           AS processos_ativos,
      (SELECT COUNT(*) FROM propostas WHERE client_id = ? AND status IN ('enviada','em_negociacao')) AS propostas_abertas,
      (SELECT COALESCE(SUM(valor),0) FROM installments WHERE client_id = ? AND status = 'pendente')  AS a_receber
  `, [id, id, id]) as any;

  res.json({ ...rows[0], resumo });
});

// ── GET /api/clients/:id/timeline — histórico do cliente (ficha) ────────────
router.get('/:id/timeline', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT t.event_type, t.description, t.created_at, u.name AS by_name,
            c.case_number, c.title AS case_title
     FROM client_timeline t
     LEFT JOIN users u ON u.id = t.created_by
     LEFT JOIN cases c ON c.id = t.case_id
     WHERE t.client_id = ? ORDER BY t.created_at DESC LIMIT 100`,
    [req.params.id]
  ) as any;
  res.json(rows);
});

// ── POST /api/clients — criar ───────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { name, tipo, cpf_cnpj, email, phone, address, notes, status } = req.body;

  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'O nome é obrigatório' });
    return;
  }

  const finalTipo   = TIPOS.includes(tipo) ? tipo : 'PF';
  const finalStatus = STATUSES.includes(status) ? status : 'ativo';

  const [result] = await db.query(
    `INSERT INTO clients (name, tipo, cpf_cnpj, email, phone, address, notes, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name.trim(), finalTipo, cpf_cnpj ?? null, email ?? null, phone ?? null,
     address ?? null, notes ?? null, finalStatus, req.user!.id]
  ) as any;

  const [rows] = await db.query('SELECT * FROM clients WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── PUT /api/clients/:id — atualizar ────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, tipo, cpf_cnpj, email, phone, address, notes, status } = req.body;

  const [existing] = await db.query('SELECT id FROM clients WHERE id = ?', [id]) as any;
  if (!existing.length) {
    res.status(404).json({ error: 'Cliente não encontrado' });
    return;
  }

  if (name !== undefined && !String(name).trim()) {
    res.status(400).json({ error: 'O nome não pode ser vazio' });
    return;
  }

  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };

  setIf('name', name?.trim?.());
  setIf('tipo', tipo, TIPOS.includes(tipo));
  setIf('cpf_cnpj', cpf_cnpj);
  setIf('email', email);
  setIf('phone', phone);
  setIf('address', address);
  setIf('notes', notes);
  setIf('status', status, STATUSES.includes(status));

  if (!fields.length) {
    res.status(400).json({ error: 'Nenhum campo válido para atualizar' });
    return;
  }

  params.push(id);
  await db.query(`UPDATE clients SET ${fields.join(', ')} WHERE id = ?`, params);

  const [rows] = await db.query('SELECT * FROM clients WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

// ── PATCH /api/clients/:id/status — ativar/inativar ─────────────────────────
router.patch('/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!STATUSES.includes(status)) {
    res.status(400).json({ error: `status deve ser um de: ${STATUSES.join(', ')}` });
    return;
  }

  const [result] = await db.query('UPDATE clients SET status = ? WHERE id = ?', [status, id]) as any;
  if (!result.affectedRows) {
    res.status(404).json({ error: 'Cliente não encontrado' });
    return;
  }

  res.json({ success: true, id: Number(id), status });
});

export default router;
