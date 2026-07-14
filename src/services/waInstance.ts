import { db } from '../config/database';
import QRCode from 'qrcode';

// Baileys via require (CJS) — mesmo padrão do megajs no backupService.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const baileys = require('@whiskeysockets/baileys');
const makeWASocket = baileys.default || baileys.makeWASocket;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pino = require('pino');

/**
 * INSTÂNCIA DE WHATSAPP (Baileys — protocolo do WhatsApp Web, sem API paga).
 * - Conecta por QR code (tela WhatsApp → Conexão); a sessão fica no BANCO
 *   (whatsapp_sessions), então sobrevive a deploys do Railway.
 * - Recebe mensagens → caixa de conversas do CRM (whatsapp_messages),
 *   vinculadas ao cliente pelo telefone.
 * - AUTO-ENVIO da fila com pausa de segurança: 1 mensagem a cada 60–120s,
 *   máximo 30/dia — reduz risco de banimento (biblioteca não-oficial).
 */

interface WAStatus {
  connected: boolean;
  connecting: boolean;
  qr: string | null;      // data URI do QR para escanear
  me: string | null;      // número conectado
  autoSend: boolean;
  sentToday: number;
  lastError: string | null;
}

const DAILY_CAP = 30;
const state: WAStatus = { connected: false, connecting: false, qr: null, me: null, autoSend: true, sentToday: 0, lastError: null };
let sock: any = null;
let autoTimer: NodeJS.Timeout | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

// ── Sessão persistida no banco (creds + chaves Signal) ──────────────────────
async function readKey(key: string): Promise<any | null> {
  const [rows] = await db.query('SELECT data FROM whatsapp_sessions WHERE session_key = ?', [key]) as any;
  return rows.length ? JSON.parse(rows[0].data, baileys.BufferJSON.reviver) : null;
}
async function writeKey(key: string, value: any): Promise<void> {
  await db.query(
    'INSERT INTO whatsapp_sessions (session_key, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
    [key, JSON.stringify(value, baileys.BufferJSON.replacer)]);
}
async function deleteKey(key: string): Promise<void> {
  await db.query('DELETE FROM whatsapp_sessions WHERE session_key = ?', [key]);
}

async function useDBAuthState() {
  const creds = (await readKey('creds')) || baileys.initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const out: Record<string, any> = {};
          for (const id of ids) {
            let v = await readKey(`${type}-${id}`);
            if (type === 'app-state-sync-key' && v) v = baileys.proto.Message.AppStateSyncKeyData.fromObject(v);
            if (v) out[id] = v;
          }
          return out;
        },
        set: async (data: Record<string, Record<string, any>>) => {
          for (const type of Object.keys(data)) {
            for (const id of Object.keys(data[type])) {
              const v = data[type][id];
              if (v) await writeKey(`${type}-${id}`, v);
              else await deleteKey(`${type}-${id}`);
            }
          }
        },
      },
    },
    saveCreds: () => writeKey('creds', creds),
  };
}

// ── Vincula telefone → cliente (últimos 8 dígitos) ──────────────────────────
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

function extractText(msg: any): string | null {
  const m = msg?.message;
  if (!m) return null;
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || null;
}

const MEDIA_TYPES: Record<string, { rotulo: string; ext: string }> = {
  imageMessage: { rotulo: 'Foto', ext: 'jpg' },
  documentMessage: { rotulo: 'Documento', ext: 'pdf' },
  audioMessage: { rotulo: 'Áudio', ext: 'ogg' },
  videoMessage: { rotulo: 'Vídeo', ext: 'mp4' },
};
const MEDIA_MAX = 15 * 1024 * 1024; // 15 MB

/** Baixa a mídia recebida, guarda no banco e registra em Documentos do cliente. */
async function storeMedia(msg: any, phone: string, clientId: number | null): Promise<{ mediaId: number; label: string } | null> {
  const m = msg?.message || {};
  const tipo = Object.keys(MEDIA_TYPES).find((k) => m[k]);
  if (!tipo) return null;
  try {
    const buffer: Buffer = await baileys.downloadMediaMessage(
      msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock?.updateMediaMessage });
    if (!buffer || buffer.length === 0 || buffer.length > MEDIA_MAX) return null;

    const info = MEDIA_TYPES[tipo];
    const mime = m[tipo]?.mimetype?.split(';')[0] || 'application/octet-stream';
    const original = m[tipo]?.fileName || '';
    const stamp = new Date().toISOString().slice(0, 10);
    const fileName = original || `WhatsApp_${info.rotulo}_${stamp}.${mime.split('/')[1] || info.ext}`;

    const [r] = await db.query(
      'INSERT INTO whatsapp_media (phone, client_id, file_name, mime, data) VALUES (?, ?, ?, ?, ?)',
      [phone, clientId, fileName.slice(0, 255), mime.slice(0, 120), buffer]) as any;
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

async function storeMessage(msg: any): Promise<void> {
  try {
    const jid = String(msg.key?.remoteJid || '');
    if (!jid.endsWith('@s.whatsapp.net')) return; // ignora grupos/status
    const phone = jid.split('@')[0];
    const clientId = await findClientByPhone(phone);

    // Mídia (foto/PDF/áudio/vídeo) → salva e registra como documento
    let mediaId: number | null = null;
    let body = extractText(msg);
    if (!msg.key?.fromMe) {
      const media = await storeMedia(msg, phone, clientId);
      if (media) { mediaId = media.mediaId; body = body || `📎 ${media.label}`; }
    }
    if (!body) return;
    const [r] = await db.query(
      `INSERT IGNORE INTO whatsapp_messages (message_id, phone, client_id, from_me, body, msg_time, media_id)
       VALUES (?, ?, ?, ?, ?, FROM_UNIXTIME(?), ?)`,
      [msg.key?.id || null, phone, clientId, msg.key?.fromMe ? 1 : 0, String(body).slice(0, 4000),
       Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000), mediaId]) as any;

    // Mensagem recebida (nova) → soma no contador de não lidas da conversa
    if (r.affectedRows > 0 && !msg.key?.fromMe) {
      await db.query(
        `INSERT INTO whatsapp_chat_meta (phone, unread) VALUES (?, 1)
         ON DUPLICATE KEY UPDATE unread = unread + 1`, [phone]).catch(() => {});
    }
  } catch { /* inbox é best-effort */ }
}

// ── Conexão ──────────────────────────────────────────────────────────────────
export async function startInstance(): Promise<void> {
  if (sock || state.connecting) return;
  state.connecting = true; state.lastError = null;
  try {
    // Versão ATUAL do protocolo — sem isso o WhatsApp derruba a conexão antes do QR
    const { version } = await baileys.fetchLatestBaileysVersion().catch(() => ({ version: undefined as any }));
    const { state: authState, saveCreds } = await useDBAuthState();
    sock = makeWASocket({
      version,
      auth: authState,
      logger: pino({ level: 'silent' }),
      browser: ['CRM Juridico', 'Chrome', '120'],
      syncFullHistory: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u: any) => {
      if (u.qr) { state.qr = await QRCode.toDataURL(u.qr).catch(() => null); }
      if (u.connection === 'open') {
        state.connected = true; state.connecting = false; state.qr = null;
        state.me = (sock.user?.id || '').split(':')[0] || null;
        console.log(`💬 WhatsApp conectado: ${state.me}`);
        scheduleAutoSend();
      }
      if (u.connection === 'close') {
        const code = u.lastDisconnect?.error?.output?.statusCode;
        state.connected = false; state.connecting = false;
        sock = null;
        if (code === baileys.DisconnectReason.loggedOut) {
          // Desconectado pelo celular — limpa a sessão (novo QR na próxima conexão)
          await db.query('DELETE FROM whatsapp_sessions').catch(() => {});
          state.qr = null; state.me = null;
          console.log('💬 WhatsApp: sessão encerrada pelo aparelho.');
        } else {
          // Queda de rede/erro — reconecta sozinho
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => { startInstance().catch(() => {}); }, 5000);
        }
      }
    });

    sock.ev.on('messages.upsert', async (ev: any) => {
      for (const m of ev.messages || []) await storeMessage(m);
    });
  } catch (e: any) {
    state.connecting = false; state.lastError = e?.message || 'Falha ao iniciar';
    sock = null;
  }
}

export async function disconnectInstance(): Promise<void> {
  try { if (sock) await sock.logout(); } catch { /* ignore */ }
  try { await db.query('DELETE FROM whatsapp_sessions'); } catch { /* ignore */ }
  sock = null;
  state.connected = false; state.connecting = false; state.qr = null; state.me = null;
}

/** Reconecta no boot se já houver sessão salva (não pede QR de novo). */
export async function startIfSession(): Promise<void> {
  try {
    const creds = await readKey('creds');
    if (creds) await startInstance();
  } catch { /* sem sessão */ }
}

// ── Envio ────────────────────────────────────────────────────────────────────
export async function sendText(phone: string, text: string, sentBy?: string): Promise<boolean> {
  if (!sock || !state.connected) return false;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 12) return false;
  try {
    await sock.sendMessage(`${digits}@s.whatsapp.net`, { text });
    await db.query(
      `INSERT INTO whatsapp_messages (phone, client_id, from_me, body, msg_time, sent_by)
       VALUES (?, ?, 1, ?, NOW(), ?)`,
      [digits, await findClientByPhone(digits), String(text).slice(0, 4000), sentBy || null]).catch(() => {});
    return true;
  } catch { return false; }
}

// ── Auto-envio da fila com pausa de segurança (60–120s · máx. 30/dia) ───────
async function sentTodayCount(): Promise<number> {
  const [[r]] = await db.query(
    "SELECT COUNT(*) AS n FROM whatsapp_queue WHERE sent_via = 'instancia' AND DATE(sent_at) = CURDATE()") as any;
  return Number(r?.n) || 0;
}

function scheduleAutoSend(): void {
  if (autoTimer) clearTimeout(autoTimer);
  const delay = 60_000 + Math.floor(Math.random() * 60_000); // 60–120s
  autoTimer = setTimeout(async () => {
    try {
      if (state.connected && state.autoSend) {
        state.sentToday = await sentTodayCount();
        if (state.sentToday < DAILY_CAP) {
          const [rows] = await db.query(
            "SELECT id, phone, message FROM whatsapp_queue WHERE status = 'pendente' ORDER BY created_at ASC LIMIT 1") as any;
          if (rows.length) {
            const ok = await sendText(rows[0].phone, rows[0].message, 'Envio automático');
            if (ok) {
              await db.query(
                "UPDATE whatsapp_queue SET status = 'enviada', sent_at = NOW(), sent_via = 'instancia' WHERE id = ?",
                [rows[0].id]);
              state.sentToday++;
            }
          }
        }
      }
    } catch { /* tenta de novo no próximo tick */ }
    if (state.connected) scheduleAutoSend();
  }, delay);
}

export function setAutoSend(on: boolean): void { state.autoSend = on; if (on && state.connected) scheduleAutoSend(); }
export function getStatus(): WAStatus { return { ...state }; }
