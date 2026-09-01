/**
 * Cliente HTTP baixo nível pra API da Uazapi (uazapiGO v2) — gateway de
 * WhatsApp hospedado por eles (substitui a instância Baileys que rodava
 * dentro do próprio CRM). Documentação oficial: https://docs.uazapi.com
 *
 * Autenticação: header `token` (token da instância) pras operações do dia a
 * dia (conectar, enviar, status); header `admintoken` só pra administração
 * da conta (criar/listar/apagar instância) — não usado no dia a dia do CRM.
 */

const BASE_URL = (process.env.UAZAPI_BASE_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.UAZAPI_TOKEN || '';

export function uazapiConfigured(): boolean {
  return !!BASE_URL && !!TOKEN;
}

async function request<T = any>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
  if (!uazapiConfigured()) throw new Error('Uazapi não configurada (defina UAZAPI_BASE_URL e UAZAPI_TOKEN)');
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { token: TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data?.message || data?.error || `Uazapi HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export interface UazapiConnectResponse {
  qrcode?: string | { base64: string };
  base64?: string;
  paircode?: string;
  instance?: { status?: string; owner?: string };
}
export interface UazapiStatusResponse {
  instance: { id: string; name: string; status: string; owner?: string; profileName?: string; qrcode?: string };
}

export const uazapi = {
  /** POST /instance/connect — gera QR code (ou pair code, se phone informado). */
  connect(phone?: string): Promise<UazapiConnectResponse> {
    return request('POST', '/instance/connect', phone ? { phone } : {});
  },
  /** GET /instance/status — status atual da instância. */
  status(): Promise<UazapiStatusResponse> {
    return request('GET', '/instance/status');
  },
  /** GET /instance/wa_messages_limits — diagnóstico de limite/restrição do WhatsApp pra iniciar conversas novas (útil pra entender um erro 463). */
  getMessageLimits(): Promise<any> {
    return request('GET', '/instance/wa_messages_limits');
  },
  /** POST /instance/logout — desconecta e apaga a sessão (pede novo QR depois). */
  logout(): Promise<void> {
    return request('POST', '/instance/logout');
  },
  /** POST /instance/reset — reset controlado do runtime, sem apagar a sessão (usar quando o envio trava sem motivo aparente). */
  resetRuntime(): Promise<any> {
    return request('POST', '/instance/reset');
  },
  /** POST /send/text — envia mensagem de texto. replyid (opcional) cita outra mensagem. */
  sendText(number: string, text: string, replyid?: string): Promise<{ messageid: string; status: string }> {
    return request('POST', '/send/text', replyid ? { number, text, replyid } : { number, text });
  },
  /**
   * POST /send/media — envia imagem/documento/vídeo/áudio. "file" é uma URL
   * que a Uazapi busca no servidor deles — por isso o CRM sobe o arquivo pra
   * whatsapp_media primeiro e manda um link assinado (signMediaUrl), não o
   * arquivo em si. Contrato confirmado testando direto: number/file/type/text
   * (sem "text" a Uazapi rejeita com "missing text for text message").
   */
  sendMedia(number: string, fileUrl: string, type: 'image' | 'document' | 'video' | 'audio' | 'ptt', text = ''): Promise<{ messageid: string; status: string }> {
    return request('POST', '/send/media', { number, file: fileUrl, type, text });
  },
  /** POST /send/pix-button — manda um botão nativo de pagamento PIX (chave/nome do titular). */
  sendPixButton(number: string, pixKey: string, pixName: string, pixType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP'): Promise<any> {
    return request('POST', '/send/pix-button', { number, pixKey, pixName, pixType });
  },
  /** POST /send/request-payment — botão nativo "Revisar e pagar" (PIX/boleto/link/cartão num só). */
  sendPaymentRequest(number: string, amount: number, extra?: { title?: string; text?: string; pixKey?: string; pixType?: string; pixName?: string; paymentLink?: string; boletoCode?: string; fileUrl?: string; fileName?: string }): Promise<any> {
    return request('POST', '/send/request-payment', { number, amount, ...extra });
  },
  /** POST /message/download — baixa mídia de uma mensagem recebida. */
  // A resposta traz o arquivo em "base64Data" (confirmado na doc oficial —
  // uazapi-openapi-spec.yaml, endpoint /message/download), não "base64"
  // como o código lia antes — por isso NENHUMA mídia recebida era salva.
  downloadMessage(messageId: string): Promise<{ base64Data?: string; fileURL?: string; mimetype?: string }> {
    return request('POST', '/message/download', { id: messageId, return_base64: true });
  },
  // Campo é "id", não "messageId" como a doc da SDK sugere — confirmado
  // testando direto (a doc devolvia "Missing Id in Payload" com messageId).
  /** POST /message/edit — edita o texto de uma mensagem já enviada (só suas, dentro do prazo do WhatsApp). */
  editMessage(messageId: string, text: string): Promise<any> {
    return request('POST', '/message/edit', { id: messageId, text });
  },
  /** POST /message/delete — apaga a mensagem para todos no chat. */
  deleteMessage(messageId: string): Promise<any> {
    return request('POST', '/message/delete', { id: messageId });
  },
  /** POST /webhook — configura a URL que recebe os eventos (mensagens etc.). */
  // enabled: true é obrigatório aqui — sem ele a Uazapi salva a configuração
  // mas mantém o webhook DESLIGADO (confirmado testando direto).
  setWebhook(url: string, events: string[]): Promise<void> {
    return request('POST', '/webhook', { url, events, enabled: true });
  },
  /** GET /webhook/errors — últimos 20 erros de entrega do NOSSO webhook (diagnóstico, fica só em memória do lado da Uazapi). */
  getWebhookErrors(): Promise<any[]> {
    return request('GET', '/webhook/errors');
  },

  // ── Ações em mensagem ──────────────────────────────────────────────────
  /** POST /message/markread — marca uma ou mais mensagens como lidas. */
  markRead(ids: string[]): Promise<any> {
    return request('POST', '/message/markread', { id: ids });
  },
  /** POST /message/react — reage (emoji) a uma mensagem; text: '' remove a reação. */
  react(number: string, messageId: string, emoji: string): Promise<any> {
    return request('POST', '/message/react', { number, id: messageId, text: emoji });
  },
  /** POST /message/pin — fixa/desafixa uma mensagem específica na conversa (não confundir com fixar a conversa). */
  pinMessage(messageId: string, pin: boolean, durationDays: 1 | 7 | 30 = 7): Promise<any> {
    return request('POST', '/message/pin', { id: messageId, pin, duration: durationDays });
  },
  /** POST /message/find — busca mensagens por chat, id ou rastreamento. */
  findMessages(params: { chatid?: string; id?: string; limit?: number; offset?: number }): Promise<any> {
    return request('POST', '/message/find', params);
  },
  /** POST /message/presence — envia indicador de "digitando…"/"gravando áudio…" (composing/recording/paused). */
  sendPresence(number: string, presence: 'composing' | 'recording' | 'paused', delayMs?: number): Promise<any> {
    return request('POST', '/message/presence', { number, presence, ...(delayMs ? { delay: delayMs } : {}) });
  },
  /** POST /message/history-sync — pede ao WhatsApp mensagens antigas de um chat (sob demanda). */
  requestHistorySync(number: string, opts?: { messageid?: string; count?: number }): Promise<any> {
    return request('POST', '/message/history-sync', { number, mode: 'history', ...opts });
  },
  /** GET /message/async — status da fila interna de envio assíncrono (diagnóstico). */
  getAsyncQueueStatus(): Promise<any> {
    return request('GET', '/message/async');
  },
  /** DELETE /message/async — cancela toda a fila de envio assíncrono pendente. */
  clearAsyncQueue(): Promise<any> {
    return request('DELETE', '/message/async');
  },
  /** POST /instance/updateDelaySettings — delay mín/máx (segundos) entre mensagens enviadas com async:true. */
  updateDelaySettings(msgDelayMin: number, msgDelayMax: number): Promise<any> {
    return request('POST', '/instance/updateDelaySettings', { msg_delay_min: msgDelayMin, msg_delay_max: msgDelayMax });
  },

  // ── Mensagens interativas e outras ─────────────────────────────────────
  /** POST /send/contact — envia cartão de contato (vCard). */
  sendContact(number: string, fullName: string, phoneNumber: string, extra?: { organization?: string; email?: string; url?: string }): Promise<any> {
    return request('POST', '/send/contact', { number, fullName, phoneNumber, ...extra });
  },
  /** POST /send/location — envia localização geográfica. */
  sendLocation(number: string, latitude: number, longitude: number, extra?: { name?: string; address?: string }): Promise<any> {
    return request('POST', '/send/location', { number, latitude, longitude, ...extra });
  },
  /** POST /send/location-button — pede que o contato compartilhe a localização dele. */
  sendLocationButton(number: string, text: string): Promise<any> {
    return request('POST', '/send/location-button', { number, text });
  },
  /**
   * POST /send/menu — botões/lista/enquete/carrossel num único endpoint.
   * choices segue a sintaxe da Uazapi (ver docs.uazapi.com) — "texto|id",
   * "[Título da Seção]" pra listas, etc.
   */
  sendMenu(number: string, type: 'button' | 'list' | 'poll' | 'carousel', text: string, choices: string[], extra?: { footerText?: string; listButton?: string; selectableCount?: number; imageButton?: string }): Promise<any> {
    return request('POST', '/send/menu', { number, type, text, choices, ...extra });
  },

  // ── Chats ────────────────────────────────────────────────────────────
  /** POST /chat/block — bloqueia/desbloqueia um contato. */
  blockChat(number: string, block: boolean): Promise<any> {
    return request('POST', '/chat/block', { number, block });
  },
  /** GET /chat/blocklist — lista de contatos bloqueados. */
  getBlocklist(): Promise<{ blockList: string[] }> {
    return request('GET', '/chat/blocklist');
  },
  /** POST /chat/notes — lê a nota interna (wa_notes) já persistida do chat. */
  getChatNotes(number: string): Promise<any> {
    return request('POST', '/chat/notes', { number });
  },
  /** POST /chat/notes/edit — grava a nota interna do chat (nativa do WhatsApp Business, sincroniza entre dispositivos). */
  editChatNotes(number: string, notes: string): Promise<any> {
    return request('POST', '/chat/notes/edit', { number, notes });
  },
  /** POST /chat/details — ficha completa do contato/chat (mais de 60 campos). */
  getChatDetails(number: string, preview = false): Promise<any> {
    return request('POST', '/chat/details', { number, preview });
  },
  /** POST /chat/check — confirma se números estão no WhatsApp (antes de mandar mensagem em massa, por exemplo). */
  checkChat(numbers: string[]): Promise<any> {
    return request('POST', '/chat/check', { numbers });
  },
  /** POST /chat/find — busca avançada de conversas com filtros (~, !~, >=, etc.). */
  findChats(filtro: Record<string, unknown>): Promise<any> {
    return request('POST', '/chat/find', filtro);
  },
  /** POST /chat/archive — arquiva/desarquiva o chat no WhatsApp de verdade (sincroniza com o celular). */
  archiveChat(number: string, archive: boolean): Promise<any> {
    return request('POST', '/chat/archive', { number, archive });
  },
  /** POST /chat/pin — fixa/desafixa o chat no topo da lista do WhatsApp de verdade. */
  pinChat(number: string, pin: boolean): Promise<any> {
    return request('POST', '/chat/pin', { number, pin });
  },
  /** POST /chat/read — marca o chat inteiro como lido/não lido no WhatsApp de verdade. */
  readChat(number: string, read: boolean): Promise<any> {
    return request('POST', '/chat/read', { number, read });
  },
  /** POST /chat/mute — silencia notificações do chat (0=remove, 8=8h, 168=1 semana, -1=permanente). */
  muteChat(number: string, muteEndTime: 0 | 8 | 168 | -1): Promise<any> {
    return request('POST', '/chat/mute', { number, muteEndTime });
  },
  /** POST /chat/delete — apaga/limpa o chat no WhatsApp e/ou no banco local da Uazapi. */
  deleteChat(number: string, opts: { deleteChatDB?: boolean; deleteMessagesDB?: boolean; deleteChatWhatsApp?: boolean; clearChatWhatsApp?: boolean }): Promise<any> {
    return request('POST', '/chat/delete', { number, ...opts });
  },
  /** POST /chat/ephemeral — mensagens temporárias num chat privado ('0'/'off', '1d', '7d', '90d'). */
  setEphemeral(number: string, duration: '0' | 'off' | '1d' | '7d' | '90d'): Promise<any> {
    return request('POST', '/chat/ephemeral', { number, duration });
  },
  /** POST /chat/labels — define/adiciona/remove etiquetas NATIVAS do WhatsApp Business num chat (por labelid). */
  setChatLabelsNative(number: string, opts: { labelids?: string[]; add_labelid?: string; remove_labelid?: string }): Promise<any> {
    return request('POST', '/chat/labels', { number, ...opts });
  },

  // ── Etiquetas ────────────────────────────────────────────────────────
  /** GET /labels — lista as etiquetas cadastradas na instância. */
  listLabels(): Promise<any> {
    return request('GET', '/labels');
  },
  /** POST /label/edit — cria ("new"), edita ou apaga (delete:true) uma etiqueta. */
  editLabel(labelId: string, opts: { name?: string; color?: number; delete?: boolean }): Promise<any> {
    return request('POST', '/label/edit', { labelid: labelId, ...opts });
  },
  /** POST /labels/refresh — força releitura das etiquetas nativas direto do WhatsApp (assíncrono). */
  refreshLabels(force = false): Promise<any> {
    return request('POST', '/labels/refresh', { force });
  },

  // ── Contatos ─────────────────────────────────────────────────────────
  /** POST /contact/add — adiciona um número à agenda do celular conectado. */
  addContact(number: string, name: string): Promise<any> {
    return request('POST', '/contact/add', { number, name });
  },
  /** POST /contact/remove — remove um número da agenda do celular conectado. */
  removeContact(number: string): Promise<any> {
    return request('POST', '/contact/remove', { number });
  },
  /** POST /contacts/list — lista contatos do WhatsApp conectado, paginado. */
  listContacts(opts?: { limit?: number; offset?: number; contactScope?: 'address_book' | 'outside_address_book' | 'all' }): Promise<any> {
    return request('POST', '/contacts/list', opts || {});
  },

  // ── Lead / campos personalizados (CRM nativo da Uazapi) ─────────────────
  /** POST /instance/updateFieldsMap — define os rótulos dos 20 campos livres de lead (lead_field01-20). */
  updateFieldsMap(fields: Record<string, string>): Promise<any> {
    return request('POST', '/instance/updateFieldsMap', fields);
  },
  /** POST /chat/editLead — edita dados de lead do chat (status, atendente, kanban, tags, campos custom). */
  editLead(id: string, fields: Record<string, unknown>): Promise<any> {
    return request('POST', '/chat/editLead', { id, ...fields });
  },

  // ── Respostas rápidas ────────────────────────────────────────────────
  /** GET /quickreply/showall — lista todos os templates de resposta rápida cadastrados. */
  listQuickReplies(): Promise<any[]> {
    return request('GET', '/quickreply/showall');
  },
  /** POST /quickreply/edit — cria (sem id), atualiza (com id) ou apaga (delete:true) um template. */
  editQuickReply(opts: { id?: string; delete?: boolean; shortCut: string; type: 'text' | 'audio' | 'myaudio' | 'ptt' | 'document' | 'video' | 'image'; text?: string; file?: string; docName?: string }): Promise<any> {
    return request('POST', '/quickreply/edit', opts);
  },
};
