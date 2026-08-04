import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { uazapi } from '../services/uazapiClient';

// Roteador PÚBLICO (sem autenticação) — a Uazapi entrega os eventos aqui.
// Substitui o listener 'messages.upsert' do Baileys (waInstance.ts): como a
// sessão agora mora no servidor da Uazapi, mensagens recebidas só chegam por
// webhook, não por um socket em processo.
const router = Router();

const MEDIA_MAX = 15 * 1024 * 1024; // 15 MB
const ROTULOS: Record<string, { rotulo: string; mime: string; ext: string }> = {
  image: { rotulo: 'Foto', mime: 'image/jpeg', ext: 'jpg' },
  document: { rotulo: 'Documento', mime: 'application/pdf', ext: 'pdf' },
  audio: { rotulo: 'Áudio', mime: 'audio/ogg', ext: 'ogg' },
  ptt: { rotulo: 'Áudio', mime: 'audio/ogg', ext: 'ogg' },
  video: { rotulo: 'Vídeo', mime: 'video/mp4', ext: 'mp4' },
  sticker: { rotulo: 'Figurinha', mime: 'image/webp', ext: 'webp' },
};

async function findClientByPhone(phone: string): Promise<number | null> {
  const tail = phone.replace(/\D/g, '').slice(-8);
  if (tail.length < 8) return null;
  try {
    const [rows] = await db.query(
      "SELECT id FROM clients WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),'(',''),')',''),'-',''),' ','') LIKE ? LIMIT 1",
      [`%${tail}`]) as any;
    return rows[0]?.id ?? null;
  } catch { return null; }
}

/** Baixa a mídia via /message/download (a Uazapi já decripta), guarda no banco e registra em Documentos. */
async function storeMedia(messageId: string, phone: string, clientId: number | null, mediaType: string): Promise<{ mediaId: number; label: string } | null> {
  const info = ROTULOS[mediaType];
  if (!info) return null;
  try {
    const dl = await uazapi.downloadMessage(messageId);
    if (!dl?.base64) return null;
    const buffer = Buffer.from(dl.base64, 'base64');
    if (!buffer.length || buffer.length > MEDIA_MAX) return null;

    const stamp = new Date().toISOString().slice(0, 10);
    const fileName = `WhatsApp_${info.rotulo}_${stamp}.${info.ext}`;

    const [r] = await db.query(
      'INSERT INTO whatsapp_media (phone, client_id, file_name, mime, data) VALUES (?, ?, ?, ?, ?)',
      [phone, clientId, fileName.slice(0, 255), info.mime, buffer]) as any;
    const mediaId = r.insertId;

    // Vira Documento do cliente automaticamente (Central de Documentos)
    if (clientId) {
      const [[adm]] = await db.query(
        "SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1") as any;
      await db.query(
        `INSERT INTO documents (client_id, name, type, folder, file_url, status, created_by)
         VALUES (?, ?, 'recebido', 'outros', ?, 'ativo', ?)`,
        [clientId, `WhatsApp — ${fileName}`.slice(0, 255), `/api/whatsapp-instance/media/${mediaId}`, adm?.id ?? 1]).catch(() => {});
    }
    return { mediaId, label: `${info.rotulo}: ${fileName}` };
  } catch { return null; }
}

// Cria o lead automaticamente na 1ª mensagem de um número desconhecido.
// Idempotente: se já existe lead com esse telefone (qualquer formato), não duplica.
async function autoLeadFromWhatsapp(phone: string, pushName: string | null, primeiraMsg: string): Promise<void> {
  const digits = phone.replace(/\D/g, '');
  const semDDI = digits.startsWith('55') ? digits.slice(2) : digits;
  const [[jaLead]] = await db.query(
    `SELECT id FROM leads WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),'(',''),')',''),'-',''),' ','') LIKE ? LIMIT 1`,
    [`%${semDDI}%`]
  ) as any;
  if (jaLead) return;

  const [[admin]] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1") as any;
  if (!admin) return;

  const nome = (pushName && pushName.trim()) || `WhatsApp +${digits}`;
  const [ins] = await db.query(
    `INSERT INTO leads (user_id, name, phone, source, status, case_summary)
     VALUES (?, ?, ?, 'whatsapp', 'triagem', ?)`,
    [admin.id, nome, digits, `Lead criado automaticamente pela 1ª mensagem no WhatsApp:\n"${primeiraMsg}"`]
  ) as any;

  try {
    const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
    for (const a of admins) {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
         VALUES (?, ?, ?, 'lead_whatsapp', 'sistema', NOW(), 'pendente')`,
        [a.id, 'Novo lead pelo WhatsApp',
         `${nome} mandou mensagem e virou lead automaticamente (nº ${ins.insertId}). Primeira mensagem: "${primeiraMsg.slice(0, 160)}"`]
      );
    }
  } catch { /* aviso é best-effort */ }
}

// ── POST /api/public/uazapi-webhook — eventos da Uazapi (mensagens) ─────────
router.post('/uazapi-webhook', async (req: Request, res: Response) => {
  res.status(200).json({ ok: true }); // confirma recebimento logo — o resto é best-effort
  try {
    const payload = req.body || {};
    // Confere que o evento é da NOSSA instância (o token vem no corpo do webhook).
    if (String(payload.token || '') !== (process.env.UAZAPI_TOKEN || '')) return;
    if (payload.EventType !== 'messages') return;

    const msg = payload.message || {};
    const chat = payload.chat || {};
    if (!msg.messageid && !msg.id) return;
    if (msg.isGroup || chat.wa_isGroup) return; // ignora grupos

    const phone = String(chat.phone || msg.sender || msg.chatid || '').replace(/\D/g, '');
    if (!phone) return;
    const clientId = await findClientByPhone(phone);

    let mediaId: number | null = null;
    let body = msg.text || (typeof msg.content === 'string' ? msg.content : '') || '';
    if (!msg.fromMe && msg.mediaType) {
      const media = await storeMedia(msg.messageid || msg.id, phone, clientId, msg.mediaType);
      if (media) { mediaId = media.mediaId; body = body || `📎 ${media.label}`; }
    }
    if (!body) return;

    const [r] = await db.query(
      `INSERT IGNORE INTO whatsapp_messages (message_id, phone, client_id, from_me, body, msg_time, media_id)
       VALUES (?, ?, ?, ?, ?, FROM_UNIXTIME(?), ?)`,
      [msg.messageid || msg.id || null, phone, clientId, msg.fromMe ? 1 : 0, String(body).slice(0, 4000),
       Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000), mediaId]) as any;

    if (r.affectedRows > 0 && !msg.fromMe) {
      await db.query(
        `INSERT INTO whatsapp_chat_meta (phone, unread) VALUES (?, 1)
         ON DUPLICATE KEY UPDATE unread = unread + 1`, [phone]).catch(() => {});

      if (!clientId) {
        await autoLeadFromWhatsapp(phone, msg.senderName || chat.wa_name || null, String(body).slice(0, 500)).catch(() => {});
      }
    }
  } catch { /* inbox é best-effort — nunca derruba o webhook */ }
});

export default router;
