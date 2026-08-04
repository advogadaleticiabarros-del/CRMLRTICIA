import { db } from '../config/database';
import { uazapi, uazapiConfigured } from './uazapiClient';

/**
 * Substitui waInstance.ts (Baileys rodando dentro do CRM) pela Uazapi
 * (gateway hospedado por eles). Mesma interface pública (getStatus,
 * startInstance, disconnectInstance, sendText, setAutoSend, startIfSession)
 * — a rota src/routes/whatsapp-instance.ts não precisou mudar.
 *
 * Diferença chave: a sessão do WhatsApp mora no servidor da Uazapi, não mais
 * no nosso banco — não existe mais "reconectar após deploy", o status é
 * sempre consultado ao vivo. Mensagens recebidas chegam por WEBHOOK (ver
 * src/routes/whatsapp-webhook.ts), não por um listener em processo.
 */

interface WAStatus {
  connected: boolean;
  connecting: boolean;
  qr: string | null;
  me: string | null;
  autoSend: boolean;
  sentToday: number;
  lastError: string | null;
}

const DAILY_CAP = 30;
let cachedQr: string | null = null;
let connecting = false;
let lastError: string | null = null;
let autoSend = true;
let autoTimer: NodeJS.Timeout | null = null;

function normalizeQr(r: any): string | null {
  const raw = (typeof r?.qrcode === 'object' ? r.qrcode?.base64 : r?.qrcode) || r?.base64 || null;
  if (!raw) return null;
  return String(raw).startsWith('data:') ? raw : `data:image/png;base64,${raw}`;
}

async function sentTodayCount(): Promise<number> {
  const [[r]] = await db.query(
    "SELECT COUNT(*) AS n FROM whatsapp_queue WHERE sent_via = 'instancia' AND DATE(sent_at) = CURDATE()") as any;
  return Number(r?.n) || 0;
}

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

export async function getStatus(): Promise<WAStatus> {
  if (!uazapiConfigured()) {
    return { connected: false, connecting: false, qr: null, me: null, autoSend, sentToday: 0, lastError: 'Uazapi não configurada' };
  }
  try {
    const r = await uazapi.status();
    const st = r?.instance?.status || 'disconnected';
    const connected = st === 'connected';
    if (connected) cachedQr = null;
    if (connected) lastError = null;
    return {
      connected,
      connecting: connecting || st === 'connecting',
      qr: connected ? null : cachedQr,
      me: connected ? (r.instance.owner || r.instance.profileName || null) : null,
      autoSend,
      sentToday: await sentTodayCount(),
      lastError,
    };
  } catch (e: any) {
    return { connected: false, connecting: false, qr: cachedQr, me: null, autoSend, sentToday: 0, lastError: e?.message || 'Falha ao consultar status' };
  }
}

export async function startInstance(): Promise<void> {
  if (connecting) return;
  connecting = true; lastError = null;
  try {
    const r = await uazapi.connect();
    cachedQr = normalizeQr(r);
    if (r?.instance?.status === 'connected') { cachedQr = null; scheduleAutoSend(); }
  } catch (e: any) {
    lastError = e?.message || 'Falha ao conectar';
  } finally {
    connecting = false;
  }
}

export async function disconnectInstance(): Promise<void> {
  try { await uazapi.logout(); } catch { /* segue mesmo se der erro — sessão pode já estar encerrada */ }
  cachedQr = null; connecting = false; lastError = null;
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
}

/** No boot: nada a "reconectar" — a sessão vive no servidor da Uazapi. Só religa o auto-envio se já estiver conectado. */
export async function startIfSession(): Promise<void> {
  if (!uazapiConfigured()) return;
  try {
    const r = await uazapi.status();
    if (r?.instance?.status === 'connected') scheduleAutoSend();
  } catch { /* Uazapi fora do ar no boot — status refletirá isso quando alguém abrir a tela */ }
}

export async function sendText(phone: string, text: string, sentBy?: string): Promise<boolean> {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 12) return false;
  try {
    await uazapi.sendText(digits, text);
    await db.query(
      `INSERT INTO whatsapp_messages (phone, client_id, from_me, body, msg_time, sent_by)
       VALUES (?, ?, 1, ?, NOW(), ?)`,
      [digits, await findClientByPhone(digits), String(text).slice(0, 4000), sentBy || null]).catch(() => {});
    return true;
  } catch (e: any) {
    lastError = e?.message || 'Falha ao enviar';
    return false;
  }
}

// ── Auto-envio da fila com pausa de segurança (60–120s · máx. 30/dia) ───────
function scheduleAutoSend(): void {
  if (autoTimer) clearTimeout(autoTimer);
  const delay = 60_000 + Math.floor(Math.random() * 60_000);
  autoTimer = setTimeout(async () => {
    try {
      if (autoSend) {
        const st = await getStatus();
        if (st.connected && st.sentToday < DAILY_CAP) {
          const [rows] = await db.query(
            "SELECT id, phone, message FROM whatsapp_queue WHERE status = 'pendente' ORDER BY created_at ASC LIMIT 1") as any;
          if (rows.length) {
            const ok = await sendText(rows[0].phone, rows[0].message, 'Envio automático');
            if (ok) {
              await db.query(
                "UPDATE whatsapp_queue SET status = 'enviada', sent_at = NOW(), sent_via = 'instancia' WHERE id = ?",
                [rows[0].id]);
            }
          }
        }
      }
    } catch { /* tenta de novo no próximo tick */ }
    scheduleAutoSend();
  }, delay);
  autoTimer.unref?.();
}

export function setAutoSend(on: boolean): void {
  autoSend = on;
  if (on) scheduleAutoSend();
  else if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
}
