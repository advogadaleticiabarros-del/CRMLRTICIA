import { Router, Request, Response } from 'express';
import { generateSecret, generateURI, verifySync as totpVerify } from 'otplib';
import QRCode from 'qrcode';
import { db } from '../config/database';
import { encrypt, decrypt } from '../utils/crypto';

const router = Router();

// ── 2FA (TOTP) — ativar/desativar o segundo fator do MEU login ──────────────
router.get('/2fa', async (req: Request, res: Response) => {
  const [[u]] = await db.query('SELECT totp_enabled FROM users WHERE id = ?', [req.user!.id]) as any;
  res.json({ enabled: !!u?.totp_enabled });
});

// Gera o segredo e o QR — só ativa depois de confirmar um código válido.
router.post('/2fa/setup', async (req: Request, res: Response) => {
  const secret = generateSecret();
  await db.query('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?', [encrypt(secret), req.user!.id]);
  const otpauth = generateURI({ issuer: 'CRM Letícia Barros', label: req.user!.email, secret });
  const qr = await QRCode.toDataURL(otpauth, { width: 220, margin: 1 });
  res.json({ qr, secret }); // o secret em texto permite cadastro manual no app
});

router.post('/2fa/enable', async (req: Request, res: Response) => {
  const code = String(req.body?.code || '').replace(/\s/g, '');
  const [[u]] = await db.query('SELECT totp_secret FROM users WHERE id = ?', [req.user!.id]) as any;
  const secret = decrypt(u?.totp_secret);
  if (!secret) { res.status(400).json({ error: 'Gere o QR primeiro (setup)' }); return; }
  if (!totpVerify({ token: code, secret }).valid) {
    res.status(400).json({ error: 'Código incorreto — confira o aplicativo e tente de novo' });
    return;
  }
  await db.query('UPDATE users SET totp_enabled = 1 WHERE id = ?', [req.user!.id]);
  res.json({ success: true });
});

router.post('/2fa/disable', async (req: Request, res: Response) => {
  const code = String(req.body?.code || '').replace(/\s/g, '');
  const [[u]] = await db.query('SELECT totp_secret, totp_enabled FROM users WHERE id = ?', [req.user!.id]) as any;
  if (!u?.totp_enabled) { res.json({ success: true }); return; }
  const secret = decrypt(u.totp_secret);
  if (!secret || !totpVerify({ token: code, secret }).valid) {
    res.status(400).json({ error: 'Para desativar, informe um código válido do aplicativo' });
    return;
  }
  await db.query('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', [req.user!.id]);
  res.json({ success: true });
});

// ── GET /api/me/cases — processos atribuídos a mim ──────────────────────────
router.get('/cases', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT c.id, c.case_number, c.title, c.legal_area, c.phase, c.status,
            cc.role AS meu_papel, cc.commission_percent, cl.name AS client_name
     FROM case_collaborators cc
     JOIN cases c ON c.id = cc.case_id
     LEFT JOIN clients cl ON cl.id = c.client_id
     WHERE cc.user_id = ?
     ORDER BY c.created_at DESC`,
    [req.user!.id]
  ) as any;
  res.json(rows);
});

// ── GET /api/me/repasses — repasse do parceiro por processo ─────────────────
router.get('/repasses', async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const [cases] = await db.query(`
    SELECT
      c.id, c.title, cl.name AS client_name, cc.commission_percent,
      COALESCE((SELECT SUM(i.valor) FROM installments i WHERE i.case_id = c.id AND i.status = 'pago'), 0)      AS recebido_caso,
      COALESCE((SELECT SUM(i.valor) FROM installments i WHERE i.case_id = c.id AND i.status = 'pendente'), 0)  AS pendente_caso
    FROM case_collaborators cc
    JOIN cases c ON c.id = cc.case_id
    LEFT JOIN clients cl ON cl.id = c.client_id
    WHERE cc.user_id = ? AND cc.commission_percent IS NOT NULL
    ORDER BY c.created_at DESC
  `, [userId]) as any;

  let totalRealizado = 0, totalPrevisto = 0;
  const detalhado = cases.map((c: any) => {
    const pct = Number(c.commission_percent) / 100;
    const realizado = Number(c.recebido_caso) * pct;
    const previsto = (Number(c.recebido_caso) + Number(c.pendente_caso)) * pct;
    totalRealizado += realizado;
    totalPrevisto += previsto;
    return {
      case_id: c.id, title: c.title, client_name: c.client_name,
      commission_percent: c.commission_percent,
      recebido_caso: Number(c.recebido_caso),
      repasse_realizado: Math.round(realizado * 100) / 100,
      repasse_previsto: Math.round(previsto * 100) / 100,
    };
  });

  res.json({
    total_realizado: Math.round(totalRealizado * 100) / 100,
    total_previsto: Math.round(totalPrevisto * 100) / 100,
    processos: detalhado,
  });
});

export default router;
