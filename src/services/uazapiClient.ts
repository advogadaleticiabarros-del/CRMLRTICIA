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
  /** POST /instance/logout — desconecta e apaga a sessão (pede novo QR depois). */
  logout(): Promise<void> {
    return request('POST', '/instance/logout');
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
  /** POST /message/download — baixa mídia de uma mensagem recebida. */
  downloadMessage(messageId: string): Promise<{ base64?: string; url?: string }> {
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
};
