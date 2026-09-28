// Sugestão de fase processual a partir do texto das movimentações (regras
// determinísticas). Extraído de monitoringService.ts pra poder ser testado
// sem banco — ideia 8 da auditoria de Processos e prazos (28/09/2026).
export const PHASE_RANK: Record<string, number> = { inicial: 1, instrucao: 2, sentenca: 3, recurso: 4, execucao: 5, encerrado: 6 };

export function faseSugeridaDoTexto(text: string): string | null {
  const t = (text || '').toLowerCase();
  if (/tr[âa]nsito em julgado|arquivad|baixa definitiva/.test(t)) return 'encerrado';
  if (/execu[çc][ãa]o|cumprimento de senten|penhora|alvar[áa]|bacenjud|sisbajud|bloqueio de valores|le[ií]l[ãa]o/.test(t)) return 'execucao';
  if (/ac[óo]rd[ãa]o|apela[çc][ãa]o|\brecurso\b|embargos de declara|agravo|recurso ordin[áa]rio|recurso de revista/.test(t)) return 'recurso';
  if (/senten[çc]a/.test(t)) return 'sentenca';
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
