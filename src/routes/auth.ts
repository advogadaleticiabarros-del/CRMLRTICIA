import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../config/database';
import { signToken, authenticate, authorize, AuthPayload } from '../middleware/auth';

const router = Router();

// ── POST /api/auth/login ────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
    return;
  }

  const [rows] = await db.query(
    'SELECT id, name, email, password, role, active FROM users WHERE email = ?',
    [email]
  ) as any;

  const user = rows[0];
  if (!user || !user.active) {
    res.status(401).json({ error: 'Credenciais inválidas' });
    return;
  }

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    res.status(401).json({ error: 'Credenciais inválidas' });
    return;
  }

  const payload: AuthPayload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };

  res.json({ token: signToken(payload), user: payload });
});

// ── POST /api/auth/forgot — recuperação de senha (avisa os admins) ──────────
// Público. Não revela se o e-mail existe (resposta sempre genérica). Quando o
// e-mail pertence a um usuário, registra o pedido e notifica os administradores
// para gerarem uma nova senha em Configurações.
router.post('/forgot', async (req: Request, res: Response) => {
  const email = String(req.body?.email || '').trim();
  const generic = { success: true, message: 'Se o e-mail estiver cadastrado, o administrador será avisado para gerar uma nova senha.' };
  if (!email) { res.status(400).json({ error: 'Informe o e-mail' }); return; }
  try {
    const [rows] = await db.query('SELECT id, name FROM users WHERE email = ? AND active = 1', [email]) as any;
    const user = rows[0];
    if (user) {
      await db.query('INSERT INTO password_reset_requests (user_id, email, status) VALUES (?, ?, \'aberto\')', [user.id, email]);
      const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
      for (const a of admins) {
        await db.query(
          `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
           VALUES (?, ?, ?, 'recuperacao_senha', 'sistema', NOW(), 'pendente')`,
          [a.id, 'Pedido de recuperação de senha', `${user.name} (${email}) esqueceu a senha. Gere uma nova em Configurações.`]
        );
      }
    }
  } catch { /* não vaza erro/inexistência */ }
  res.json(generic);
});

// ── GET /api/auth/reset-requests — pedidos de recuperação abertos (admin) ────
router.get('/reset-requests', authenticate, authorize('admin'), async (_req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT r.id, r.user_id, r.email, r.created_at, u.name
       FROM password_reset_requests r LEFT JOIN users u ON u.id = r.user_id
      WHERE r.status = 'aberto' ORDER BY r.created_at DESC`
  ) as any;
  res.json(rows);
});

// ── GET /api/auth/me ────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req: Request, res: Response) => {
  const [rows] = await db.query(
    'SELECT id, name, email, role, active, created_at FROM users WHERE id = ?',
    [req.user!.id]
  ) as any;

  if (!rows.length) {
    res.status(404).json({ error: 'Usuário não encontrado' });
    return;
  }

  res.json(rows[0]);
});

// ── POST /api/auth/register (somente admin cria novos usuários) ──────────────
router.post('/register', authenticate, authorize('admin'), async (req: Request, res: Response) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    res.status(400).json({ error: 'name, email e password são obrigatórios' });
    return;
  }

  if (String(password).length < 8) {
    res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres' });
    return;
  }

  const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]) as any;
  if (existing.length) {
    res.status(409).json({ error: 'E-mail já cadastrado' });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const allowedRoles = ['admin', 'advogado', 'staff'];
  const finalRole = allowedRoles.includes(role) ? role : 'advogado';

  const [result] = await db.query(
    'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
    [name, email, hash, finalRole]
  ) as any;

  res.status(201).json({ id: result.insertId, name, email, role: finalRole });
});

// ── PATCH /api/auth/password (trocar a própria senha) ───────────────────────
router.patch('/password', authenticate, async (req: Request, res: Response) => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    res.status(400).json({ error: 'current_password e new_password são obrigatórios' });
    return;
  }
  if (String(new_password).length < 8) {
    res.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres' });
    return;
  }

  const [rows] = await db.query('SELECT password FROM users WHERE id = ?', [req.user!.id]) as any;
  const ok = await bcrypt.compare(current_password, rows[0].password);
  if (!ok) {
    res.status(401).json({ error: 'Senha atual incorreta' });
    return;
  }

  const hash = await bcrypt.hash(new_password, 10);
  await db.query('UPDATE users SET password = ? WHERE id = ?', [hash, req.user!.id]);
  res.json({ success: true });
});

export default router;
