import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { startInstance, disconnectInstance, sendText, getStatus, setAutoSend } from '../services/waInstance';

const router = Router();

// ── GET /api/whatsapp-instance/status — conexão + QR (quando aguardando) ────
router.get('/status', (_req: Request, res: Response) => {
  res.json(getStatus());
});

// ── POST /api/whatsapp-instance/connect — inicia (gera QR se sem sessão) ────
router.post('/connect', async (_req: Request, res: Response) => {
  await startInstance();
  res.json(getStatus());
});

// ── POST /api/whatsapp-instance/disconnect — encerra e apaga a sessão ───────
router.post('/disconnect', async (_req: Request, res: Response) => {
  await disconnectInstance();
  res.json(getStatus());
});

// ── POST /api/whatsapp-instance/auto — liga/desliga o envio automático ──────
router.post('/auto', (req: Request, res: Response) => {
  setAutoSend(!!req.body?.on);
  res.json(getStatus());
});

// ── GET /api/whatsapp-instance/chats — conversas (última mensagem de cada) ──
router.get('/chats', async (_req: Request, res: Response) => {
  const [rows] = await db.query(`
    SELECT w.phone,
           MAX(w.msg_time) AS last_time,
           SUBSTRING_INDEX(GROUP_CONCAT(w.body ORDER BY w.msg_time DESC, w.id DESC SEPARATOR '\\n§§'), '\\n§§', 1) AS last_body,
           MAX(w.client_id) AS client_id,
           MAX(cl.name) AS client_name
      FROM whatsapp_messages w
      LEFT JOIN clients cl ON cl.id = w.client_id
     GROUP BY w.phone
     ORDER BY last_time DESC LIMIT 60`) as any;
  res.json(rows);
});

// ── GET /api/whatsapp-instance/chats/:phone — mensagens da conversa ─────────
router.get('/chats/:phone', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const [rows] = await db.query(
    `SELECT id, from_me, body, msg_time FROM whatsapp_messages
      WHERE phone = ? ORDER BY msg_time ASC, id ASC LIMIT 300`, [phone]) as any;
  res.json(rows);
});

// ── POST /api/whatsapp-instance/chats/:phone/send — responder pela instância ─
router.post('/chats/:phone/send', async (req: Request, res: Response) => {
  const text = String(req.body?.text || '').trim();
  if (!text) { res.status(400).json({ error: 'Escreva a mensagem' }); return; }
  const ok = await sendText(req.params.phone, text);
  if (!ok) { res.status(400).json({ error: 'Instância desconectada — conecte na aba Conexão' }); return; }
  res.json({ success: true });
});

export default router;
