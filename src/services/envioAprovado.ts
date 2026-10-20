/**
 * Como sai uma mensagem da fila de aprovação depois que alguém da equipe aprova.
 *
 * Desde 20/10/2026 as automações antigas a cliente (acompanhamento de proposta,
 * recusa, expiração, aceite com PIX, newsletter, e-book) também passam pela
 * fila ("Não envie mais nenhuma mensagem sem consentimento", Jessica, 19/10).
 * Algumas tinham botões nativos e uma pendência que o webhook espera resolver
 * (Sim/Não da newsletter, "Preciso de mais tempo"), ou o botão de PIX. O
 * rascunho guarda esse jeito de enviar (`atendente_rascunhos.envio`) e este
 * módulo o executa com o texto aprovado (editado ou não).
 *
 * Só `enviarRascunho` (atendenteServico) chama isto: é o único caminho com
 * aprovação humana. O teste semEnvioSemConsentimento confere.
 */

export type PendenciaBotao = {
  tipo: string; leadId?: number | null; clientId?: number | null; propostaId?: number | null;
  expectedYes: string; expectedNo: string;
};
export type TipoChavePix = 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP';
export type EnvioAprovado =
  | { tipo: 'texto' }
  | { tipo: 'botoes'; botoes: string[]; pendencia?: PendenciaBotao }
  | { tipo: 'texto_pix'; pix: { chave: string; nome: string; tipoChave: TipoChavePix } };

export interface DepsEnvio {
  sendText(phone: string, texto: string, sentBy: string): Promise<boolean>;
  sendMenu(phone: string, texto: string, botoes: string[]): Promise<unknown>;
  sendPix(phone: string, chave: string, nome: string, tipo: TipoChavePix, sentBy: string): Promise<boolean>;
  criarPendencia(p: PendenciaBotao & { phone: string }): Promise<void>;
}

/** Lê o que está gravado no rascunho; qualquer coisa estranha vira texto simples. */
export function lerEnvio(v: unknown): EnvioAprovado {
  let e: any = v;
  if (typeof v === 'string') { try { e = JSON.parse(v); } catch { e = null; } }
  if (e?.tipo === 'botoes' && Array.isArray(e.botoes) && e.botoes.length) return e;
  if (e?.tipo === 'texto_pix' && e.pix?.chave) return e;
  return { tipo: 'texto' };
}

function depsPadrao(): DepsEnvio {
  return {
    sendText: async (phone, texto, sentBy) => (await import('./uazapiInstance')).sendText(phone, texto, sentBy),
    sendMenu: async (phone, texto, botoes) => (await import('./uazapiClient')).uazapi.sendMenu(phone, 'button', texto, botoes),
    sendPix: async (phone, chave, nome, tipo, sentBy) => (await import('./uazapiInstance')).sendPixButton(phone, chave, nome, tipo, sentBy),
    criarPendencia: async (p) => (await import('./pendingWhatsappReplyService')).createPendingReply(p),
  };
}

/** Envia a mensagem aprovada. Devolve se o texto chegou a sair. */
export async function executarEnvioAprovado(
  phone: string, texto: string, envio: EnvioAprovado, sentBy: string, deps: DepsEnvio = depsPadrao(),
): Promise<boolean> {
  if (envio.tipo === 'botoes') {
    try { await deps.sendMenu(phone, texto, envio.botoes); } catch { return false; }
    // Pendência só depois do envio: sem a mensagem, ela ficaria órfã.
    if (envio.pendencia) await deps.criarPendencia({ ...envio.pendencia, phone }).catch(() => {});
    return true;
  }
  const ok = await deps.sendText(phone, texto, sentBy).catch(() => false);
  if (ok && envio.tipo === 'texto_pix') {
    await deps.sendPix(phone, envio.pix.chave, envio.pix.nome, envio.pix.tipoChave, sentBy).catch(() => false);
  }
  return ok;
}
