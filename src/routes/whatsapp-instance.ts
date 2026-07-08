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

// ── GET /api/whatsapp-instance/chats — conversas (última msg + etiquetas + não lidas)
router.get('/chats', async (_req: Request, res: Response) => {
  const [rows] = await db.query(`
    SELECT w.phone,
           MAX(w.msg_time) AS last_time,
           SUBSTRING_INDEX(GROUP_CONCAT(w.body ORDER BY w.msg_time DESC, w.id DESC SEPARATOR '\\n§§'), '\\n§§', 1) AS last_body,
           SUBSTRING_INDEX(GROUP_CONCAT(w.from_me ORDER BY w.msg_time DESC, w.id DESC), ',', 1) AS last_from_me,
           MAX(w.client_id) AS client_id,
           MAX(cl.name) AS client_name,
           MAX(m.unread) AS unread,
           MAX(m.labels) AS labels
      FROM whatsapp_messages w
      LEFT JOIN clients cl ON cl.id = w.client_id
      LEFT JOIN whatsapp_chat_meta m ON m.phone = w.phone
     GROUP BY w.phone
     ORDER BY last_time DESC LIMIT 100`) as any;
  res.json(rows);
});

// ── POST /api/whatsapp-instance/chats/:phone/read — zera as não lidas ───────
router.post('/chats/:phone/read', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  await db.query(
    'INSERT INTO whatsapp_chat_meta (phone, unread) VALUES (?, 0) ON DUPLICATE KEY UPDATE unread = 0', [phone]);
  res.json({ success: true });
});

// ── POST /api/whatsapp-instance/chats/:phone/labels — etiquetas da conversa ─
router.post('/chats/:phone/labels', async (req: Request, res: Response) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const labels = Array.isArray(req.body?.labels)
    ? req.body.labels.map((l: any) => String(l).trim().slice(0, 30)).filter(Boolean).slice(0, 6)
    : [];
  await db.query(
    'INSERT INTO whatsapp_chat_meta (phone, labels) VALUES (?, ?) ON DUPLICATE KEY UPDATE labels = VALUES(labels)',
    [phone, JSON.stringify(labels)]);
  res.json({ success: true, labels });
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
