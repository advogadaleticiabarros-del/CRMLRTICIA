import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { verifySync as totpVerify } from 'otplib';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server';
import { db } from '../config/database';
import { env } from '../config/env';
import { WEBAUTHN_RP_ID, WEBAUTHN_RP_NAME, WEBAUTHN_ORIGIN } from '../config/webauthn';
import { decrypt } from '../utils/crypto';
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
    'SELECT id, name, email, password, role, active, totp_enabled FROM users WHERE email = ?',
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

  // 2FA ligado → senha certa ainda não entra: devolve um passe temporário (5 min)
  // e o front pede o código do aplicativo autenticador.
  if (user.totp_enabled) {
    const tmp = jwt.sign({ id: user.id, purpose: '2fa' }, env.JWT_SECRET, { expiresIn: '5m' });
    res.json({ requires_2fa: true, tmp });
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

// ── POST /api/auth/login/2fa — 2ª etapa: código do autenticador ─────────────
router.post('/login/2fa', async (req: Request, res: Response) => {
  const { tmp, code } = req.body || {};
  if (!tmp || !code) { res.status(400).json({ error: 'Informe o código do autenticador' }); return; }

  const bloqueado = isBlocked(req);
  if (bloqueado) { res.status(429).json({ error: `Muitas tentativas. Aguarde ${bloqueado} minuto(s).` }); return; }

  let decoded: any;
  try { decoded = jwt.verify(String(tmp), env.JWT_SECRET); } catch { decoded = null; }
  if (!decoded || decoded.purpose !== '2fa') {
    res.status(401).json({ error: 'Sessão de verificação expirada — faça login novamente' });
    return;
  }

  const [[user]] = await db.query(
    'SELECT id, name, email, role, active, totp_secret, totp_enabled FROM users WHERE id = ?',
    [decoded.id]
  ) as any;
  if (!user || !user.active || !user.totp_enabled) { res.status(401).json({ error: 'Credenciais inválidas' }); return; }

  const secret = decrypt(user.totp_secret);
  if (!secret || !totpVerify({ token: String(code).replace(/\s/g, ''), secret }).valid) {
    registerFail(req);
    res.status(401).json({ error: 'Código incorreto — confira o aplicativo autenticador' });
    return;
  }
  loginAttempts.delete(loginKey(req));

  const payload: AuthPayload = { id: user.id, email: user.email, name: user.name, role: user.role };
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

// ═════════════════════════════════════════════════════════════════════════
// Passkey / WebAuthn (Face ID no iPhone) — item 5 do plano de autenticação
// biométrica. MÉTODO ADICIONAL: e-mail/senha (+2FA) continua funcionando
// normalmente; isto só oferece um atalho a mais.
//
// Só funciona depois que o CRM foi instalado na Tela de Início do iPhone
// como PWA (Face ID via navegador comum do Safari é bloqueado pela Apple) —
// dependência já resolvida no item 2 do plano (aviso de instalação).
//
// O desafio (challenge) do WebAuthn é stateless: guardamos ele dentro de um
// JWT de vida curta (mesmo padrão já usado no "tmp" do login com 2FA acima)
// em vez de sessão/tabela — não há servidor com estado compartilhado aqui.
// ═════════════════════════════════════════════════════════════════════════

interface PasskeyChallengeToken {
  purpose: 'passkey_reg' | 'passkey_login';
  challenge: string;
  userId?: number;
}

function signChallenge(payload: PasskeyChallengeToken, expiresIn: string): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn } as jwt.SignOptions);
}
function readChallenge(token: string, purpose: PasskeyChallengeToken['purpose']): PasskeyChallengeToken | null {
  try {
    const decoded = jwt.verify(String(token), env.JWT_SECRET) as PasskeyChallengeToken;
    if (decoded.purpose !== purpose) return null;
    return decoded;
  } catch {
    return null;
  }
}

// Rate limit dedicado para a rota de login por passkey (superfície de auth
// nova — sem isso daria pra floodar/enumerar). Mesmo esquema do login normal
// (5 tentativas por 15 min), mas por IP, já que aqui não se digita e-mail.
const passkeyAttempts = new Map<string, { count: number; first: number }>();
function passkeyKey(req: Request): string { return `passkey|${req.ip || 'ip'}`; }
function passkeyBlocked(req: Request): number {
  const a = passkeyAttempts.get(passkeyKey(req));
  if (!a) return 0;
  if (Date.now() - a.first > LOGIN_WINDOW_MS) { passkeyAttempts.delete(passkeyKey(req)); return 0; }
  return a.count >= LOGIN_MAX ? Math.ceil((a.first + LOGIN_WINDOW_MS - Date.now()) / 60000) : 0;
}
function passkeyRegisterFail(req: Request): void {
  const k = passkeyKey(req);
  const a = passkeyAttempts.get(k);
  if (!a || Date.now() - a.first > LOGIN_WINDOW_MS) passkeyAttempts.set(k, { count: 1, first: Date.now() });
  else a.count++;
  if (passkeyAttempts.size > 5000) passkeyAttempts.clear();
}

// ── POST /api/auth/passkey/register/options — cadastro (usuária já logada) ──
router.post('/passkey/register/options', authenticate, async (req: Request, res: Response) => {
  const [existing] = await db.query(
    'SELECT credential_id, transports FROM user_passkeys WHERE user_id = ?',
    [req.user!.id]
  ) as any;

  const options = await generateRegistrationOptions({
    rpName: WEBAUTHN_RP_NAME,
    rpID: WEBAUTHN_RP_ID,
    userID: Buffer.from(String(req.user!.id)),
    userName: req.user!.email,
    userDisplayName: req.user!.name,
    attestationType: 'none',
    excludeCredentials: existing.map((p: any) => ({
      id: p.credential_id,
      transports: p.transports ? JSON.parse(p.transports) : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred', // pede Face ID/Touch ID quando disponível, sem travar em aparelhos sem biometria
    },
  });

  const regToken = signChallenge({ purpose: 'passkey_reg', challenge: options.challenge, userId: req.user!.id }, '5m');
  res.json({ options, regToken });
});

// ── POST /api/auth/passkey/register/verify — confirma e salva a credencial ──
router.post('/passkey/register/verify', authenticate, async (req: Request, res: Response) => {
  const { regToken, response, deviceName } = req.body || {};
  if (!regToken || !response) { res.status(400).json({ error: 'Dados de cadastro incompletos' }); return; }

  const decoded = readChallenge(regToken, 'passkey_reg');
  if (!decoded || decoded.userId !== req.user!.id) {
    res.status(401).json({ error: 'Cadastro expirado — tente novamente' });
    return;
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: decoded.challenge,
      expectedOrigin: WEBAUTHN_ORIGIN,
      expectedRPID: WEBAUTHN_RP_ID,
    });
  } catch (err) {
    res.status(400).json({ error: 'Não foi possível validar este aparelho: ' + (err as Error).message });
    return;
  }

  if (!verification.verified || !verification.registrationInfo) {
    res.status(400).json({ error: 'Cadastro do Face ID não confirmado' });
    return;
  }

  const { credential } = verification.registrationInfo;
  try {
    await db.query(
      `INSERT INTO user_passkeys (user_id, credential_id, public_key, counter, device_name, transports)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.user!.id,
        credential.id,
        Buffer.from(credential.publicKey).toString('base64'),
        credential.counter,
        String(deviceName || '').trim().slice(0, 120) || null,
        JSON.stringify(credential.transports || []),
      ]
    );
  } catch (err: any) {
    if (err?.code === 'ER_DUP_ENTRY') { res.status(409).json({ error: 'Este aparelho já está cadastrado' }); return; }
    throw err;
  }

  // eslint-disable-next-line no-console
  console.log(`[auth] Passkey cadastrada — usuário #${req.user!.id} (${req.user!.email}), aparelho "${deviceName || 's/ nome'}"`);
  res.status(201).json({ success: true });
});

// ── GET /api/auth/passkey — lista as passkeys da própria conta ──────────────
router.get('/passkey', authenticate, async (req: Request, res: Response) => {
  const [rows] = await db.query(
    'SELECT id, device_name, created_at, last_used_at FROM user_passkeys WHERE user_id = ? ORDER BY created_at DESC',
    [req.user!.id]
  ) as any;
  res.json(rows);
});

// ── DELETE /api/auth/passkey/:id — remove uma passkey da própria conta ──────
router.delete('/passkey/:id', authenticate, async (req: Request, res: Response) => {
  const [result] = await db.query(
    'DELETE FROM user_passkeys WHERE id = ? AND user_id = ?',
    [req.params.id, req.user!.id]
  ) as any;
  if (!result.affectedRows) { res.status(404).json({ error: 'Passkey não encontrada' }); return; }
  // eslint-disable-next-line no-console
  console.log(`[auth] Passkey removida — usuário #${req.user!.id} (${req.user!.email}), id ${req.params.id}`);
  res.json({ success: true });
});

// ── POST /api/auth/passkey/login/options — login (não-autenticado) ──────────
// Fluxo "usernameless"/discoverable: não pede e-mail antes, o próprio
// aparelho já mostra a lista de passkeys salvas nele para este site.
router.post('/passkey/login/options', async (req: Request, res: Response) => {
  const bloqueado = passkeyBlocked(req);
  if (bloqueado) { res.status(429).json({ error: `Muitas tentativas. Aguarde ${bloqueado} minuto(s).` }); return; }

  const options = await generateAuthenticationOptions({
    rpID: WEBAUTHN_RP_ID,
    userVerification: 'preferred',
  });
  const loginToken = signChallenge({ purpose: 'passkey_login', challenge: options.challenge }, '2m');
  res.json({ options, loginToken });
});

// ── POST /api/auth/passkey/login/verify — confere a assinatura e loga ───────
router.post('/passkey/login/verify', async (req: Request, res: Response) => {
  const { loginToken, response } = req.body || {};
  if (!loginToken || !response) { res.status(400).json({ error: 'Dados de login incompletos' }); return; }

  const bloqueado = passkeyBlocked(req);
  if (bloqueado) { res.status(429).json({ error: `Muitas tentativas. Aguarde ${bloqueado} minuto(s).` }); return; }

  const decoded = readChallenge(loginToken, 'passkey_login');
  if (!decoded) {
    passkeyRegisterFail(req);
    res.status(401).json({ error: 'Sessão de login expirada — tente novamente' });
    return;
  }

  const credentialId = (response as AuthenticationResponseJSON)?.id;
  const [rows] = await db.query(
    `SELECT p.id, p.credential_id, p.public_key, p.counter, p.transports, p.user_id,
            u.name, u.email, u.role, u.active
       FROM user_passkeys p JOIN users u ON u.id = p.user_id
      WHERE p.credential_id = ?`,
    [credentialId]
  ) as any;
  const row = rows[0];
  if (!row || !row.active) {
    passkeyRegisterFail(req);
    res.status(401).json({ error: 'Passkey não reconhecida' });
    return;
  }

  const credential: WebAuthnCredential = {
    id: row.credential_id,
    publicKey: new Uint8Array(Buffer.from(row.public_key, 'base64')),
    counter: Number(row.counter),
    transports: row.transports ? JSON.parse(row.transports) : undefined,
  };

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: response as AuthenticationResponseJSON,
      expectedChallenge: decoded.challenge,
      expectedOrigin: WEBAUTHN_ORIGIN,
      expectedRPID: WEBAUTHN_RP_ID,
      credential,
    });
  } catch (err) {
    // Cobre inclusive o caso do contador vir igual/menor que o salvo (sinal
    // de credencial clonada) — a biblioteca recusa e cai aqui.
    passkeyRegisterFail(req);
    // eslint-disable-next-line no-console
    console.warn(`[auth] Falha ao validar passkey — usuário #${row.user_id}: ${(err as Error).message}`);
    res.status(401).json({ error: 'Não foi possível confirmar o Face ID' });
    return;
  }

  if (!verification.verified) {
    passkeyRegisterFail(req);
    res.status(401).json({ error: 'Não foi possível confirmar o Face ID' });
    return;
  }
  passkeyAttempts.delete(passkeyKey(req));

  await db.query(
    'UPDATE user_passkeys SET counter = ?, last_used_at = NOW() WHERE id = ?',
    [verification.authenticationInfo.newCounter, row.id]
  );

  // eslint-disable-next-line no-console
  console.log(`[auth] Login por passkey (Face ID) — usuário #${row.user_id} (${row.email})`);

  const payload: AuthPayload = { id: row.user_id, email: row.email, name: row.name, role: row.role };
  res.json({ token: signToken(payload), user: payload });
});

export default router;
