import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../config/database';

const router = Router();

const ROLES = ['admin', 'advogado', 'estagiario', 'parceiro', 'cliente'];
const COMMISSIONS = [30, 50];

// ── GET /api/users — lista usuários ─────────────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.email, u.role, u.active, u.commission_percent, u.client_id,
            c.name AS client_name, u.created_at
     FROM users u
     LEFT JOIN clients c ON c.id = u.client_id
     ORDER BY u.role, u.name`
  ) as any;
  res.json(rows);
});

// ── POST /api/users — cadastrar usuário ─────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { name, email, password, role, commission_percent, client_id } = req.body;

  if (!name || !email || !password) {
    res.status(400).json({ error: 'name, email e password são obrigatórios' }); return;
  }
  if (String(password).length < 8) {
    res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres' }); return;
  }
  if (!ROLES.includes(role)) {
    res.status(400).json({ error: `Papel inválido. Use: ${ROLES.join(', ')}` }); return;
  }
  if (role === 'parceiro' && !COMMISSIONS.includes(Number(commission_percent))) {
    res.status(400).json({ error: 'Parceiro exige repasse de 30 ou 50' }); return;
  }
  if (role === 'cliente' && !client_id) {
    res.status(400).json({ error: 'Usuário cliente precisa estar vinculado a um cliente' }); return;
  }

  const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]) as any;
  if (existing.length) { res.status(409).json({ error: 'E-mail já cadastrado' }); return; }

  // valida o cliente vinculado
  if (role === 'cliente') {
    const [cl] = await db.query('SELECT id FROM clients WHERE id = ?', [client_id]) as any;
    if (!cl.length) { res.status(400).json({ error: 'Cliente vinculado não encontrado' }); return; }
  }

  const hash = await bcrypt.hash(password, 10);
  const [result] = await db.query(
    `INSERT INTO users (name, email, password, role, commission_percent, client_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, email, hash, role,
     role === 'parceiro' ? Number(commission_percent) : null,
     role === 'cliente' ? client_id : null]
  ) as any;

  res.status(201).json({ id: result.insertId, name, email, role });
});

// ── PUT /api/users/:id — editar papel/comissão/ativo ────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (Number(id) === req.user!.id) {
    res.status(400).json({ error: 'Não é possível alterar o próprio usuário aqui' }); return;
  }
  const [existing] = await db.query('SELECT id FROM users WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Usuário não encontrado' }); return; }

  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };
  setIf('name', req.body.name);
  setIf('role', req.body.role, ROLES.includes(req.body.role));
  setIf('active', req.body.active !== undefined ? (req.body.active ? 1 : 0) : undefined);
  setIf('commission_percent', req.body.commission_percent, COMMISSIONS.includes(Number(req.body.commission_percent)));

  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido para atualizar' }); return; }
  params.push(id);
  await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

// ── POST /api/users/:id/reset-password — redefine senha ─────────────────────
router.post('/:id/reset-password', async (req: Request, res: Response) => {
  const { new_password } = req.body;
  if (!new_password || String(new_password).length < 8) {
    res.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres' }); return;
  }
  const hash = await bcrypt.hash(new_password, 10);
  const [result] = await db.query('UPDATE users SET password = ? WHERE id = ?', [hash, req.params.id]) as any;
  if (!result.affectedRows) { res.status(404).json({ error: 'Usuário não encontrado' }); return; }
  res.json({ success: true });
});

export default router;
