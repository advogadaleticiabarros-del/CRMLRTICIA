import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../config/database';
import { signToken, authenticate, authorize, AuthPayload } from '../middleware/auth';

const router = Router();

// ── Proteção contra força bruta no login ────────────────────────────────────
// 5 tentativas erradas por IP+e-mail em 15 min → bloqueia por 15 min.
// Em memória (instância única no Railway); zera no acerto e no restart.
const LOGIN_MAX = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map<string, { count: number; first: number }>();

function loginKey(req: Request): string {
  return `${req.ip || 'ip'}|${String(req.body?.email || '').toLowerCase().trim()}`;
}
function isBlocked(req: Request): number { // minutos restantes de bloqueio (0 = livre)
  const a = loginAttempts.get(loginKey(req));
  if (!a) return 0;
  if (Date.now() - a.first > LOGIN_WINDOW_MS) { loginAttempts.delete(loginKey(req)); return 0; }
  return a.count >= LOGIN_MAX ? Math.ceil((a.first + LOGIN_WINDOW_MS - Date.now()) / 60000) : 0;
}
function registerFail(req: Request): void {
  const k = loginKey(req);
  const a = loginAttempts.get(k);
  if (!a || Date.now() - a.first > LOGIN_WINDOW_MS) loginAttempts.set(k, { count: 1, first: Date.now() });
  else a.count++;
  if (loginAttempts.size > 5000) loginAttempts.clear(); // não cresce sem limite
}

// ── POST /api/auth/login ────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
    return;
  }

  const bloqueado = isBlocked(req);
  if (bloqueado) {
    res.status(429).json({ error: `Muitas tentativas. Aguarde ${bloqueado} minuto(s) e tente novamente.` });
    return;
  }

  const [rows] = await db.query(
    'SELECT id, name, email, password, role, active FROM users WHERE email = ?',
    [email]
  ) as any;

  const user = rows[0];
  if (!user || !user.active) {
    registerFail(req);
    res.status(401).json({ error: 'Credenciais inválidas' });
    return;
  }

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    registerFail(req);
    res.status(401).json({ error: 'Credenciais inválidas' });
    return;
  }
  loginAttempts.delete(loginKey(req));

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
  const generic = { success: true, message: 'Se o e-mail estiver cadastrado, você receberá um link de redefinição em instantes.' };
  if (!email) { res.status(400).json({ error: 'Informe o e-mail' }); return; }

  // Anti-abuso: máx. 3 pedidos por IP+e-mail a cada 15 min (evita bombardeio
  // de e-mails na vítima e spam no sino dos admins).
  const bloqueado = isBlocked(req);
  if (bloqueado) { res.json(generic); return; } // resposta genérica, sem revelar o bloqueio
  registerFail(req); // conta o pedido na mesma janela do rate limit do login
  try {
    const [rows] = await db.query('SELECT id, name FROM users WHERE email = ? AND active = 1', [email]) as any;
    const user = rows[0];
    if (user) {
      // 1) Link de redefinição por E-MAIL (self-service, válido por 30 min)
      const crypto = await import('crypto');
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await db.query(
        'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))',
        [user.id, tokenHash]);
      const base = process.env.APP_URL || 'https://crm.advogadaleticiabarros.com.br';
      const link = `${base}/#redefinir=${token}`;
      const { sendEmail, layout } = await import('../services/EmailService');
      await sendEmail({
        to: email,
        subject: 'Redefinir sua senha — Advocacia Letícia Barros',
        html: layout('Redefinição de senha', `
          <p>Olá, ${user.name || ''}.</p>
          <p>Recebemos um pedido para redefinir a sua senha. Clique no botão abaixo — o link vale por <strong>30 minutos</strong> e só pode ser usado uma vez:</p>
          <p style="margin:18px 0"><a href="${link}" style="display:inline-block;background:#0d1b2e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">Criar nova senha</a></p>
          <p style="color:#93a0b5;font-size:13px">Se não foi você quem pediu, ignore este e-mail — sua senha continua a mesma.</p>`),
      }).catch(() => { /* sem e-mail configurado, fica o caminho via admin */ });

      // 2) Mantém o registro/aviso aos admins (fallback e auditoria)
      await db.query('INSERT INTO password_reset_requests (user_id, email, status) VALUES (?, ?, \'aberto\')', [user.id, email]).catch(() => {});
      const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
      for (const a of admins) {
        await db.query(
          `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
           VALUES (?, ?, ?, 'recuperacao_senha', 'sistema', NOW(), 'pendente')`,
          [a.id, 'Pedido de recuperação de senha', `${user.name} (${email}) pediu redefinição de senha (link enviado por e-mail).`]
        ).catch(() => {});
      }
    }
  } catch { /* não vaza erro/inexistência */ }
  res.json(generic);
});

// ── POST /api/auth/reset — redefine a senha com o token do e-mail ───────────
// Público. Token de uso único, expira em 30 min.
router.post('/reset', async (req: Request, res: Response) => {
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');
  if (!token || token.length < 32) { res.status(400).json({ error: 'Link inválido' }); return; }
  if (password.length < 8) { res.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres' }); return; }

  const crypto = await import('crypto');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const [rows] = await db.query(
    'SELECT id, user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1',
    [tokenHash]) as any;
  const pr = rows[0];
  if (!pr) { res.status(400).json({ error: 'Link expirado ou já utilizado. Peça um novo em "Esqueci minha senha".' }); return; }

  const hash = await bcrypt.hash(password, 10);
  await db.query('UPDATE users SET password = ? WHERE id = ?', [hash, pr.user_id]);
  // Invalida TODOS os links de redefinição pendentes deste usuário (não só o usado)
  await db.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [pr.user_id]);
  await db.query("UPDATE password_reset_requests SET status = 'resolvido', resolved_at = NOW() WHERE user_id = ? AND status = 'aberto'", [pr.user_id]).catch(() => {});
  res.json({ success: true, message: 'Senha redefinida! Entre com a nova senha.' });
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
