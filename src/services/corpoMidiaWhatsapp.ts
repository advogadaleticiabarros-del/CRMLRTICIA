/**
 * Texto da mensagem do WhatsApp quando a mídia falha ao baixar (23/11/2026).
 *
 * Antes, mídia COM legenda que falhava guardava só a legenda, sem a marca
 * "falhou ao baixar" — a varredura `whatsapp:midias-falhadas` procura essa
 * marca, então foto/documento com legenda nunca era recuperado e os agentes
 * (Analista, Coletor) ficavam sem o arquivo. Agora a marca vai sempre junto,
 * e na recuperação a legenda volta inteira.
 */
const LINHA_FALHA = /\n?⚠️ Mídia (recebida|enviada por você), mas falhou ao baixar \(tipo: [\w]+\)/;

export function corpoComFalhaDeMidia(legenda: string | null | undefined, deMim: boolean, tipo: string): string {
  const aviso = deMim
    ? `⚠️ Mídia enviada por você, mas falhou ao baixar (tipo: ${tipo})`
    : `⚠️ Mídia recebida, mas falhou ao baixar (tipo: ${tipo})`;
  const l = String(legenda || '').trim();
  return l ? `${l}\n${aviso}` : aviso;
}

/** Depois de recuperar: tira o aviso; sem legenda, mostra o rótulo do arquivo. */
export function corpoMidiaRecuperada(corpo: string | null | undefined, rotulo: string): string {
  const resto = String(corpo || '').replace(LINHA_FALHA, '').trim();
  return resto || `📎 ${rotulo}`;
}
