import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../config/database';
import { sendNewPassword, sendCredentials, isEmailConfigured } from '../services/EmailService';

const router = Router();

const ROLES = ['admin', 'advogado', 'estagiario', 'parceiro', 'cliente', 'parceiro_portal'];
const COMMISSIONS = [30, 50];

// ── GET /api/users — lista usuários ─────────────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.email, u.role, u.active, u.commission_percent, u.client_id, u.partner_id,
            c.name AS client_name, pt.name AS partner_name, u.created_at
     FROM users u
     LEFT JOIN clients c ON c.id = u.client_id
     LEFT JOIN partners pt ON pt.id = u.partner_id
     ORDER BY u.role, u.name`
  ) as any;
  res.json(rows);
});

// ── POST /api/users — cadastrar usuário ─────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { name, email, password, role, commission_percent, client_id, partner_id } = req.body;

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
  if (role === 'parceiro_portal' && !partner_id) {
    res.status(400).json({ error: 'Usuário do portal do parceiro precisa estar vinculado a um parceiro' }); return;
  }

  const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]) as any;
  if (existing.length) { res.status(409).json({ error: 'E-mail já cadastrado' }); return; }

  // valida o cliente vinculado
  if (role === 'cliente') {
    const [cl] = await db.query('SELECT id FROM clients WHERE id = ?', [client_id]) as any;
    if (!cl.length) { res.status(400).json({ error: 'Cliente vinculado não encontrado' }); return; }
  }
  if (role === 'parceiro_portal') {
    const [pt] = await db.query('SELECT id FROM partners WHERE id = ?', [partner_id]) as any;
    if (!pt.length) { res.status(400).json({ error: 'Parceiro vinculado não encontrado' }); return; }
  }

  const hash = await bcrypt.hash(password, 10);
  const [result] = await db.query(
    `INSERT INTO users (name, email, password, role, commission_percent, client_id, partner_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, email, hash, role,
     role === 'parceiro' ? Number(commission_percent) : null,
     role === 'cliente' ? client_id : null,
     role === 'parceiro_portal' ? partner_id : null]
  ) as any;

  // Envia as credenciais por e-mail (se o e-mail estiver configurado no servidor).
  let emailed = false;
  const r = await sendCredentials(email, name, password).catch(() => ({ ok: false }));
  emailed = !!r.ok;

  res.status(201).json({ id: result.insertId, name, email, role, emailed });
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

/** Gera uma senha temporária forte e legível (sem caracteres ambíguos). */
function gerarSenha(len = 10): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ── POST /api/users/:id/reset-password — admin redefine OU gera nova senha ──
// Sem new_password no corpo: o sistema GERA uma senha temporária e a devolve
// para o admin repassar ao usuário. Com new_password: usa a informada (>=8).
router.post('/:id/reset-password', async (req: Request, res: Response) => {
  const provided = req.body?.new_password;
  if (provided !== undefined && String(provided).length < 8) {
    res.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres' }); return;
  }
  const senha = provided ? String(provided) : gerarSenha();
  const hash = await bcrypt.hash(senha, 10);
  const [users] = await db.query('SELECT name, email FROM users WHERE id = ?', [req.params.id]) as any;
  if (!users.length) { res.status(404).json({ error: 'Usuário não encontrado' }); return; }
  await db.query('UPDATE users SET password = ? WHERE id = ?', [hash, req.params.id]);
  // Marca eventuais pedidos de recuperação como resolvidos.
  try { await db.query("UPDATE password_reset_requests SET status = 'resolvido', resolved_by = ?, resolved_at = NOW() WHERE user_id = ? AND status = 'aberto'", [req.user!.id, req.params.id]); } catch {}

  // Envia a nova senha por e-mail (se configurado). Continua devolvendo ao admin como fallback.
  const r = await sendNewPassword(users[0].email, users[0].name, senha).catch(() => ({ ok: false }));

  res.json({ success: true, generated: !provided, password: provided ? undefined : senha, emailed: !!r.ok });
});

export default router;
