import { db } from '../config/database';
import { uazapi, uazapiConfigured } from './uazapiClient';
import { emitWaUpdate } from './waSocket';

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
/** Motivo real do último envio/ação que falhou — pra rota não precisar
 * chutar uma mensagem genérica ("confira a conexão") quando a conexão
 * está ok e o problema foi outra coisa (ex.: arquivo inválido). */
export function getLastError(): string | null { return lastError; }

/**
 * Avisa os admins no sino quando um envio AUTOMÁTICO de WhatsApp falha
 * (monitoramento de processo, lembrete, cobrança...). sendText() nunca
 * lança — ele resolve pra `false` em erro — e até agora os crons faziam
 * `.catch(() => {})` em cima disso, o que não pega nada (a promise nunca
 * rejeita): a falha ficava só no console do servidor, ninguém via.
 * Chamar isso quando `await sendText(...)` volta `false`.
 *
 * Throttle de 30min por chave (mesma tabela/padrão de avisarFalhaMidia em
 * whatsapp-webhook.ts) — evita 1 notificação por mensagem se a instância
 * cair no meio de um lote de lembretes.
 */
export async function avisarFalhaEnvioWhatsapp(contexto: string, telefone: string): Promise<void> {
  try {
    const janela = Math.floor(Date.now() / (30 * 60 * 1000));
    const [dup] = await db.query(
      'INSERT IGNORE INTO sent_reminders (ref_key, channel) VALUES (?, ?)',
      [`wa_envio_falhou_${contexto}_${janela}`, 'sino']) as any;
    if (!dup.affectedRows) return;
    const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
    for (const a of admins) {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
         VALUES (?, ?, ?, 'whatsapp_envio_falhou', 'sistema', NOW(), 'pendente')`,
        [a.id, '⚠️ Envio automático de WhatsApp falhou',
         `Contexto: ${contexto}. Telefone: ${telefone}. Motivo: ${lastError || 'desconhecido'}. Confira se a instância está conectada (Configurações → Conexão do WhatsApp).`]
      ).catch(() => {});
    }
  } catch { /* aviso é best-effort — nunca deve derrubar o cron que chamou */ }
}

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
    await uazapi.setWebhook(`${base}/api/public/uazapi-webhook`, ['messages', 'message_status', 'presence']);
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

export async function sendText(phone: string, text: string, sentBy?: string, replyToDbId?: number): Promise<boolean> {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 12) return false;
  try {
    // Citar mensagem (reply/quote): busca o message_id real da Uazapi da
    // mensagem apontada + guarda uma "foto" do texto pra continuar exibindo
    // a citação mesmo que a original seja editada/apagada depois.
    let replyUazapiId: string | undefined;
    let replySnapshot: { body: string; fromMe: number } | null = null;
    if (replyToDbId) {
      const [[orig]] = await db.query('SELECT message_id, body, from_me FROM whatsapp_messages WHERE id = ? AND phone = ?', [replyToDbId, digits]) as any;
      if (orig?.message_id) { replyUazapiId = orig.message_id; replySnapshot = { body: orig.body, fromMe: orig.from_me }; }
    }
    const r = await uazapi.sendText(digits, text, replyUazapiId);
    // Guarda o messageid real da Uazapi: o webhook manda de volta um "eco" da
    // própria mensagem enviada, e sem o message_id aqui a deduplicação
    // (UNIQUE em message_id) não reconhece que é a mesma — duplicava a
    // mensagem na conversa (confirmado testando um envio real).
    await db.query(
      `INSERT IGNORE INTO whatsapp_messages (message_id, phone, client_id, from_me, body, msg_time, sent_by, reply_to_message_id, reply_to_body, reply_to_from_me)
       VALUES (?, ?, ?, 1, ?, NOW(), ?, ?, ?, ?)`,
      [r?.messageid || null, digits, await findClientByPhone(digits), String(text).slice(0, 4000), sentBy || null,
       replyToDbId || null, replySnapshot?.body.slice(0, 500) || null, replySnapshot ? replySnapshot.fromMe : null]).catch(() => {});
    emitWaUpdate(digits);
    return true;
  } catch (e: any) {
    lastError = e?.message || 'Falha ao enviar';
    return false;
  }
}

/** Botão nativo de pagamento PIX (chave/titular clicáveis no WhatsApp), em vez de texto puro. */
export async function sendPixButton(phone: string, pixKey: string, pixName: string, pixType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP', sentBy?: string): Promise<boolean> {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 12) return false;
  try {
    const r = await uazapi.sendPixButton(digits, pixKey, pixName, pixType);
    await db.query(
      `INSERT IGNORE INTO whatsapp_messages (message_id, phone, client_id, from_me, body, msg_time, sent_by)
       VALUES (?, ?, ?, 1, ?, NOW(), ?)`,
      [r?.messageid || null, digits, await findClientByPhone(digits), `💳 Botão PIX — ${pixName} (${pixKey})`, sentBy || null]).catch(() => {});
    return true;
  } catch (e: any) {
    lastError = e?.message || 'Falha ao enviar botão PIX';
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
    emitWaUpdate(digits);
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

/** Apagar exige motivo (auditoria) — registrado ANTES de sobrescrever o texto original. */
export async function apagarMensagem(dbId: number, reason: string, userId: number | null): Promise<boolean> {
  try {
    const [[m]] = await db.query('SELECT message_id, phone, body, from_me FROM whatsapp_messages WHERE id = ?', [dbId]) as any;
    if (!m || !m.message_id || !m.from_me) return false;
    await uazapi.deleteMessage(m.message_id);
    await db.query(
      'INSERT INTO whatsapp_message_deletions (message_id, phone, body_original, reason, deleted_by) VALUES (?, ?, ?, ?, ?)',
      [dbId, m.phone, m.body, reason, userId]
    );
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
            } else {
              await avisarFalhaEnvioWhatsapp('fila_whatsapp', rows[0].phone);
            }
          }
        }
      }
    } catch { /* tenta de novo no próximo tick */ }
    scheduleAutoSend();
  }, delay);
  autoTimer.unref?.();
}

/** Reage (emoji) a uma mensagem específica da conversa — text vazio remove a reação. */
export async function reagirMensagem(phone: string, dbId: number, emoji: string): Promise<boolean> {
  try {
    const [[m]] = await db.query('SELECT message_id FROM whatsapp_messages WHERE id = ?', [dbId]) as any;
    if (!m?.message_id) return false;
    await uazapi.react(phone.replace(/\D/g, ''), m.message_id, emoji);
    return true;
  } catch (e: any) { lastError = e?.message || 'Falha ao reagir'; return false; }
}

/** Marca mensagens (da própria conversa, recebidas) como lidas do lado do WhatsApp. */
export async function marcarComoLida(dbIds: number[]): Promise<boolean> {
  try {
    const [rows] = await db.query('SELECT message_id FROM whatsapp_messages WHERE id IN (?)', [dbIds]) as any;
    const ids = rows.map((r: any) => r.message_id).filter(Boolean);
    if (!ids.length) return false;
    await uazapi.markRead(ids);
    return true;
  } catch (e: any) { lastError = e?.message || 'Falha ao marcar como lida'; return false; }
}

/** Bloqueia/desbloqueia um contato — ele para de conseguir mandar mensagem pra instância. */
export async function bloquearContato(phone: string, block: boolean): Promise<boolean> {
  try { await uazapi.blockChat(phone.replace(/\D/g, ''), block); return true; }
  catch (e: any) { lastError = e?.message || 'Falha ao bloquear/desbloquear'; return false; }
}

/** Nota interna do chat (nativa do WhatsApp Business, sincroniza com o celular) — complementa os "relatos" do CRM. */
export async function obterNotaDoChat(phone: string): Promise<string> {
  try { const r = await uazapi.getChatNotes(phone.replace(/\D/g, '')); return r?.wa_notes || ''; }
  catch { return ''; }
}
export async function salvarNotaDoChat(phone: string, notas: string): Promise<boolean> {
  try { await uazapi.editChatNotes(phone.replace(/\D/g, ''), notas); return true; }
  catch (e: any) { lastError = e?.message || 'Falha ao salvar nota'; return false; }
}

/** Mostra "digitando…"/"gravando áudio…" pro contato antes da resposta chegar. */
export async function enviarPresenca(phone: string, tipo: 'composing' | 'recording', delayMs?: number): Promise<boolean> {
  try { await uazapi.sendPresence(phone.replace(/\D/g, ''), tipo, delayMs); return true; }
  catch { return false; /* cosmético — nunca deve travar o envio real */ }
}

// Ações abaixo espelham no WhatsApp de verdade (celular) o que já é feito
// localmente em whatsapp_chat_meta — best-effort: se a Uazapi falhar (ex:
// desconectada), o estado local continua valendo pra UI do CRM.
export async function arquivarConversaNativo(phone: string, archive: boolean): Promise<boolean> {
  try { await uazapi.archiveChat(phone.replace(/\D/g, ''), archive); return true; }
  catch { return false; /* best-effort — o estado local (whatsapp_chat_meta) já reflete a ação na UI */ }
}
export async function fixarConversaNativo(phone: string, pin: boolean): Promise<boolean> {
  try { await uazapi.pinChat(phone.replace(/\D/g, ''), pin); return true; }
  catch { return false; }
}
export async function marcarChatLido(phone: string, read: boolean): Promise<boolean> {
  try { await uazapi.readChat(phone.replace(/\D/g, ''), read); return true; }
  catch { return false; }
}

/** Silencia notificações do chat. horas: 0 remove, 8 = 8h, 168 = 1 semana, -1 = permanente. */
export async function silenciarChat(phone: string, horas: 0 | 8 | 168 | -1): Promise<boolean> {
  try { await uazapi.muteChat(phone.replace(/\D/g, ''), horas); return true; }
  catch (e: any) { lastError = e?.message || 'Falha ao silenciar conversa'; return false; }
}

/** Apaga e/ou limpa a conversa (WhatsApp de verdade e/ou só o registro local da Uazapi). */
export async function apagarConversaWhatsapp(phone: string, opts: { deleteChatWhatsApp?: boolean; clearChatWhatsApp?: boolean; deleteChatDB?: boolean; deleteMessagesDB?: boolean }): Promise<boolean> {
  try { await uazapi.deleteChat(phone.replace(/\D/g, ''), opts); return true; }
  catch (e: any) { lastError = e?.message || 'Falha ao apagar conversa'; return false; }
}

/** Mensagens temporárias (disappearing messages) num chat privado. */
export async function configurarMensagensEfemeras(phone: string, duration: '0' | 'off' | '1d' | '7d' | '90d'): Promise<boolean> {
  try { await uazapi.setEphemeral(phone.replace(/\D/g, ''), duration); return true; }
  catch (e: any) { lastError = e?.message || 'Falha ao configurar mensagens temporárias'; return false; }
}

/** Pede ao WhatsApp mensagens antigas de um chat (sob demanda — "carregar mais" no topo da conversa). */
export async function solicitarHistoricoAntigo(phone: string, count = 50): Promise<boolean> {
  try { await uazapi.requestHistorySync(phone.replace(/\D/g, ''), { count }); return true; }
  catch (e: any) { lastError = e?.message || 'Falha ao solicitar histórico'; return false; }
}

// ── Respostas rápidas (templates de atalho, ex: "/saudacao") ────────────────
export async function listarRespostasRapidas(): Promise<any[]> {
  try { return await uazapi.listQuickReplies() || []; }
  catch { return []; }
}
export async function salvarRespostaRapida(opts: { id?: string; shortCut: string; type: 'text'; text: string }): Promise<{ ok: boolean; error?: string }> {
  try { await uazapi.editQuickReply(opts); return { ok: true }; }
  catch (e: any) { return { ok: false, error: e?.message || 'Falha ao salvar resposta rápida' }; }
}
export async function excluirRespostaRapida(id: string): Promise<boolean> {
  try { await uazapi.editQuickReply({ id, shortCut: '', type: 'text', delete: true }); return true; }
  catch (e: any) { lastError = e?.message || 'Falha ao excluir resposta rápida'; return false; }
}

export function setAutoSend(on: boolean): void {
  autoSend = on;
  if (on) scheduleAutoSend();
  else if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
}
