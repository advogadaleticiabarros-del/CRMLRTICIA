/**
 * Regras comuns das chamadas de IA (23/11/2026, revisão dos agentes).
 *
 *  - TEMPO LIMITE: nenhuma chamada tinha. Provedor que trava deixava o agente
 *    (e a rotina dele) esperando para sempre. Agora cada chamada desiste no
 *    tempo do seu tipo e o laço de provedores tenta o próximo.
 *  - RESPOSTA VAZIA NÃO É SUCESSO: o Gemini devolve texto vazio quando bloqueia
 *    por segurança ou estoura o tamanho (finishReason SAFETY/MAX_TOKENS), e a
 *    OpenAI quando o modelo de raciocínio gasta o limite pensando
 *    (finish_reason "length"). Antes isso voltava como ok:true com '' e o
 *    agente seguia com nada. Agora vira falha com o motivo, e entra a reserva.
 *  - RESPOSTA DE ERRO EM HTML (502 do provedor) não quebra a leitura.
 */
export const TEMPO_IA_MS = {
  /** embeddings, classificação curta */
  rapido: 45_000,
  /** análise, triagem, transcrição, leitura de um documento */
  normal: 150_000,
  /** redação de peça, briefing com vários PDFs, raciocínio "alto" */
  longo: 330_000,
} as const;

export function sinalIa(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

/** JSON da resposta, ou {} se o corpo não for JSON (página de erro do provedor). */
export async function lerJsonIa(r: { json(): Promise<unknown> }): Promise<any> {
  try { return (await r.json()) ?? {}; } catch { return {}; }
}

/** Texto do Gemini, ou o motivo de ter vindo vazio. */
export function textoGemini(d: any): { texto: string; motivo?: string } {
  const c = d?.candidates?.[0];
  const texto = String(c?.content?.parts?.map((p: any) => p?.text || '').join('') || '');
  if (texto.trim()) return { texto };
  const motivo = d?.promptFeedback?.blockReason || c?.finishReason || 'sem texto';
  return { texto: '', motivo: `Gemini não devolveu texto (${motivo})` };
}

/** Texto da OpenAI/Groq (formato chat), ou o motivo de ter vindo vazio. */
export function textoChat(d: any, provedor = 'OpenAI'): { texto: string; motivo?: string } {
  const ch = d?.choices?.[0];
  const texto = String(ch?.message?.content || '');
  if (texto.trim()) return { texto };
  const motivo = ch?.message?.refusal ? `recusou: ${String(ch.message.refusal).slice(0, 120)}` : (ch?.finish_reason || 'sem texto');
  return { texto: '', motivo: `${provedor} não devolveu texto (${motivo})` };
}

/** Mensagem legível para tempo esgotado (AbortSignal.timeout lança TimeoutError). */
export function mensagemErroIa(e: any, provedor: string): string {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return `${provedor} não respondeu a tempo`;
  return e?.message || String(e);
}
