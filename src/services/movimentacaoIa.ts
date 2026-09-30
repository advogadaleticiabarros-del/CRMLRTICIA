/**
 * Formato fixo (JSON) da análise de movimentação processual pela IA.
 * Antes o sistema "recortava" RESUMO:/AÇÃO: de texto solto — se a IA
 * escrevesse diferente, falhava em silêncio. Agora a IA responde em modo JSON
 * e cada campo é validado aqui; resposta inválida devolve null (a
 * movimentação fica como "não analisada", visível no briefing).
 */

export const TIPOS_MOVIMENTACAO = [
  'sentenca', 'acordao', 'decisao', 'despacho', 'intimacao', 'citacao',
  'audiencia', 'recurso', 'transito_julgado', 'juntada', 'outro',
] as const;
export type TipoMovimentacao = typeof TIPOS_MOVIMENTACAO[number];

export const TIPO_MOVIMENTACAO_PT: Record<TipoMovimentacao, string> = {
  sentenca: 'Sentença', acordao: 'Acórdão', decisao: 'Decisão', despacho: 'Despacho',
  intimacao: 'Intimação', citacao: 'Citação', audiencia: 'Audiência', recurso: 'Recurso',
  transito_julgado: 'Trânsito em julgado', juntada: 'Juntada', outro: 'Outro',
};

export interface MovimentacaoIa {
  resumo: string;
  acao: string;
  prazo_interno: string;
  prioridade: 'Alta' | 'Média' | 'Baixa';
  tipo: TipoMovimentacao;
  grau: '1º grau' | '2º grau' | 'Tribunal superior' | null;
}

export const PROMPT_MOVIMENTACAO_JSON = `Responda SOMENTE com um objeto JSON, sem texto fora dele, com estas chaves:
{"resumo": "1-2 linhas, linguagem simples",
 "acao": "ação necessária, ou \\"nenhuma\\" se for andamento de rotina",
 "prazo_interno": "data sugerida dd/mm/aaaa, ou \\"sem prazo\\"",
 "prioridade": "Alta" | "Média" | "Baixa",
 "tipo": ${TIPOS_MOVIMENTACAO.map((t) => `"${t}"`).join(' | ')},
 "grau": "1" | "2" | "superior" | null}
Não invente nada que não esteja no texto.`;

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function normTipo(v: unknown): TipoMovimentacao {
  const s = semAcento(String(v ?? '')).replace(/\s+/g, '_');
  if ((TIPOS_MOVIMENTACAO as readonly string[]).includes(s)) return s as TipoMovimentacao;
  if (s.startsWith('transito')) return 'transito_julgado';
  return 'outro';
}

function normGrau(v: unknown): MovimentacaoIa['grau'] {
  const s = semAcento(String(v ?? ''));
  if (/^1/.test(s) || s.includes('primeiro')) return '1º grau';
  if (/^2/.test(s) || s.includes('segundo')) return '2º grau';
  if (s.includes('superior') || /^(stj|stf|tst)$/.test(s)) return 'Tribunal superior';
  return null;
}

function normPrioridade(v: unknown): MovimentacaoIa['prioridade'] {
  const s = semAcento(String(v ?? ''));
  if (s === 'alta') return 'Alta';
  if (s === 'media') return 'Média';
  return 'Baixa';
}

/** Valida a resposta JSON da IA. null = formato inválido ou sem resumo. */
export function parseMovimentacaoJson(texto: string): MovimentacaoIa | null {
  const limpo = String(texto || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!limpo.startsWith('{')) return null;
  let o: any;
  try { o = JSON.parse(limpo); } catch { return null; }
  const resumo = typeof o?.resumo === 'string' ? o.resumo.trim() : '';
  if (!resumo) return null;
  return {
    resumo,
    acao: typeof o.acao === 'string' ? o.acao.trim() : '',
    prazo_interno: typeof o.prazo_interno === 'string' ? o.prazo_interno.trim() : '',
    prioridade: normPrioridade(o.prioridade),
    tipo: normTipo(o.tipo),
    grau: normGrau(o.grau),
  };
}
