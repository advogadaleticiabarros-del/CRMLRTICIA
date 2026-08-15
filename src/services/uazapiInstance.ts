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

// O QR vem aninhado em instance.qrcode (já como data URI completa) — testado
// direto na API, não no topo da resposta como a documentação sugeria.
function normalizeQr(r: any): string | null {
  const raw = r?.instance?.qrcode
    || (typeof r?.qrcode === 'object' ? r.qrcode?.base64 : r?.qrcode)
    || r?.base64 || null;
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
    let r = await uazapi.status();
    let st = r?.instance?.status || 'disconnected';
    let connected = st === 'connected';
    if (connected) { cachedQr = null; lastError = null; }
    // O status ao vivo também traz o QR — mantém atualizado a cada consulta
    // (o front sonda a cada 3s). O QR expira em ~2min ("QR Code timeout") e
    // a Uazapi NÃO renova sozinha — se isso acontecer no meio de uma tentativa
    // de conexão (já tínhamos um QR em mãos), pede um novo automaticamente,
    // sem a pessoa precisar clicar em "Conectar" de novo (é o que a tela promete).
    else if (r?.instance?.qrcode) {
      cachedQr = normalizeQr(r);
    } else if (cachedQr && st === 'disconnected') {
      await startInstance();
      r = await uazapi.status();
      st = r?.instance?.status || 'disconnected';
      connected = st === 'connected';
      if (connected) cachedQr = null;
    }
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
  // Garante "message_status" no webhook (confirmação de leitura ✓✓) toda vez
  // que reconecta — best-effort, nunca derruba a conexão se falhar.
  try {
    const base = (process.env.APP_BASE_URL || 'https://crm.advogadaleticiabarros.com.br').replace(/\/+$/, '');
    await uazapi.setWebhook(`${base}/api/public/uazapi-webhook`, ['messages', 'message_status']);
  } catch { /* opcional */ }
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
    const r = await uazapi.sendText(digits, text);
    // Guarda o messageid real da Uazapi: o webhook manda de volta um "eco" da
    // própria mensagem enviada, e sem o message_id aqui a deduplicação
    // (UNIQUE em message_id) não reconhece que é a mesma — duplicava a
    // mensagem na conversa (confirmado testando um envio real).
    await db.query(
      `INSERT IGNORE INTO whatsapp_messages (message_id, phone, client_id, from_me, body, msg_time, sent_by)
       VALUES (?, ?, ?, 1, ?, NOW(), ?)`,
      [r?.messageid || null, digits, await findClientByPhone(digits), String(text).slice(0, 4000), sentBy || null]).catch(() => {});
    return true;
  } catch (e: any) {
    lastError = e?.message || 'Falha ao enviar';
    return false;
  }
}

// "ptt" é o tipo que a Uazapi espera pra virar a bolha redonda de mensagem
// de voz (com PTT:true no retorno — testado direto); "audio" manda o MESMO
// arquivo, mas vira um anexo de áudio comum, sem o visual de voice note.
// Confirmado testando os dois: só muda o "type" no /send/media, a Uazapi já
// transcodifica pra ogg/opus sozinha (não precisa converter no CRM).
function tipoUazapi(mime: string, comoVoz: boolean): 'image' | 'document' | 'video' | 'audio' | 'ptt' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return comoVoz ? 'ptt' : 'audio';
  return 'document';
}

/**
 * Envia um arquivo (documento/imagem/etc). O arquivo já precisa estar salvo
 * em whatsapp_media (fileName/mime/data) — quem chama isso decide a origem
 * (upload do computador ou um documento já existente no GED do cliente) e
 * copia os bytes pra lá primeiro. Assim a mensagem enviada aparece na
 * conversa exatamente como uma recebida (mesmo media_id, mesmo /media/:id).
 * comoVoz=true (gravação feita no próprio CRM) manda como mensagem de voz.
 */
export async function sendMedia(phone: string, mediaId: number, caption: string, sentBy?: string, comoVoz = false): Promise<boolean> {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 12) return false;
  try {
    const [[m]] = await db.query('SELECT file_name, mime FROM whatsapp_media WHERE id = ?', [mediaId]) as any;
    if (!m) { lastError = 'Arquivo não encontrado'; return false; }
    const { signMediaUrl } = await import('../routes/whatsapp-instance');
    const url = signMediaUrl(`/api/whatsapp-instance/media/${mediaId}`);
    const base = (process.env.APP_BASE_URL || 'https://crm.advogadaleticiabarros.com.br').replace(/\/+$/, '');
    const r = await uazapi.sendMedia(digits, `${base}${url}`, tipoUazapi(String(m.mime || ''), comoVoz), caption || '');
    await db.query(
      `INSERT IGNORE INTO whatsapp_messages (message_id, phone, client_id, from_me, body, msg_time, media_id, sent_by)
       VALUES (?, ?, ?, 1, ?, NOW(), ?, ?)`,
      [r?.messageid || null, digits, await findClientByPhone(digits), caption || `📎 ${m.file_name}`, mediaId, sentBy || null]).catch(() => {});
    return true;
  } catch (e: any) {
    lastError = e?.message || 'Falha ao enviar arquivo';
    return false;
  }
}

// Só dá pra editar/apagar mensagem NOSSA (from_me) — o WhatsApp não permite
// mexer em mensagem de quem está do outro lado, e a Uazapi também recusa
// fora do prazo dela (edição ~15min, exclusão alguns dias).
export async function editarMensagem(dbId: number, novoTexto: string): Promise<boolean> {
  try {
    const [[m]] = await db.query('SELECT message_id, from_me FROM whatsapp_messages WHERE id = ?', [dbId]) as any;
    if (!m || !m.message_id || !m.from_me) return false;
    await uazapi.editMessage(m.message_id, novoTexto);
    await db.query('UPDATE whatsapp_messages SET body = ? WHERE id = ?', [novoTexto, dbId]);
    return true;
  } catch (e: any) {
    lastError = e?.message || 'Falha ao editar mensagem';
    return false;
  }
}

export async function apagarMensagem(dbId: number): Promise<boolean> {
  try {
    const [[m]] = await db.query('SELECT message_id, from_me FROM whatsapp_messages WHERE id = ?', [dbId]) as any;
    if (!m || !m.message_id || !m.from_me) return false;
    await uazapi.deleteMessage(m.message_id);
    // Mantém a linha (registro/prova), só marca como apagada — igual ao
    // próprio WhatsApp, que mostra "mensagem apagada" no lugar do texto.
    await db.query("UPDATE whatsapp_messages SET body = '🚫 Mensagem apagada' WHERE id = ?", [dbId]);
    return true;
  } catch (e: any) {
    lastError = e?.message || 'Falha ao apagar mensagem';
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
