// Sugestão de fase processual a partir do texto das movimentações (regras
// determinísticas). Extraído de monitoringService.ts pra poder ser testado
// sem banco — ideia 8 da auditoria de Processos e prazos (28/09/2026).
export const PHASE_RANK: Record<string, number> = { inicial: 1, instrucao: 2, sentenca: 3, recurso: 4, execucao: 5, encerrado: 6 };

// Intimações do DJEN trazem o despacho inteiro, com frases que só MENCIONAM um
// ato futuro ou hipotético ("recurso apropriado do e-Proc" para os quesitos,
// "venham conclusos para sentença", "eventual sentença de improcedência").
// Elas puxavam a fase para recurso/sentença com o processo ainda na perícia
// (incidente 07/10/2026) — então são apagadas antes de classificar.
const MENCOES_SEM_ATO = [
  /(por meio|atrav[ée]s) d[eo] recurso apropriado[^.]*/g,
  /recurso (apropriado|pr[óo]prio) do (e-?proc|sistema)/g,
  /(venham|voltem|retornem|fa[çc]am-se)( os autos)? conclusos para senten[çc]a/g,
  /(eventual|futura|posterior|oportuna) (senten[çc]a|recurso|apela[çc][ãa]o)[^.,;]*/g,
  /(em caso|na hip[óo]tese) de (eventual )?(senten[çc]a|recurso|apela[çc][ãa]o)[^.,;]*/g,
];

export function faseSugeridaDoTexto(text: string): string | null {
  let t = (text || '').toLowerCase();
  for (const re of MENCOES_SEM_ATO) t = t.replace(re, ' ');
  if (/tr[âa]nsito em julgado|arquivad|baixa definitiva/.test(t)) return 'encerrado';
  if (/execu[çc][ãa]o|cumprimento de senten|penhora|alvar[áa]|bacenjud|sisbajud|bloqueio de valores|le[ií]l[ãa]o/.test(t)) return 'execucao';
  if (/ac[óo]rd[ãa]o|apela[çc][ãa]o|\brecurso\b|contrarraz|embargos de declara|agravo|recurso ordin[áa]rio|recurso de revista/.test(t)) return 'recurso';
  if (/senten[çc]a|julg(o|ad[oa]) (im)?procedente|procedente em parte/.test(t)) return 'sentenca';
  if (/audi[êe]ncia|instru[çc][ãa]o|contesta[çc][ãa]o|r[ée]plica|per[íi]cia|saneador|sanea/.test(t)) return 'instrucao';
  if (/cita[çc][ãa]o|distribu|autua|recebida a inicial|peti[çc][ãa]o inicial|ajuiza/.test(t)) return 'inicial';
  return null;
}

/** Fase mais avançada detectada entre várias movimentações, ou null se nenhuma bater. */
export function melhorFase(textos: string[]): string | null {
  let best: string | null = null;
  let bestRank = 0;
  for (const tx of textos) {
    const ph = faseSugeridaDoTexto(tx);
    if (ph && PHASE_RANK[ph] > bestRank) { best = ph; bestRank = PHASE_RANK[ph]; }
  }
  return best;
}
