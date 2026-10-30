/**
 * Endereçamento (cabeçalho) das peças trabalhistas — regra da Jessica, 30/10/2026:
 *   "DOUTO JUÍZO DA ___ VARA DO TRABALHO DE (CIDADE) – (ESTADO)"
 * A vara fica em branco (sai na distribuição). Cidade e estado entram quando se sabe;
 * senão ficam os marcadores (CIDADE) e (ESTADO) para a Dra. preencher.
 *
 * Duas camadas: a regra vai no prompt da redação e, depois, `aplicarEnderecamento`
 * garante a 1ª linha da peça (a IA às vezes volta ao "EXCELENTÍSSIMO SENHOR JUIZ…").
 */

export function ehAreaTrabalhista(area: string | null | undefined): boolean {
  const a = String(area || '').toLowerCase();
  return a === 'gestante' || a.includes('trabalh');
}

export function enderecamentoTrabalhista(cidade?: string | null, uf?: string | null): string {
  const c = String(cidade || '').trim().toUpperCase() || '(CIDADE)';
  const e = String(uf || '').trim().toUpperCase() || '(ESTADO)';
  return `DOUTO JUÍZO DA ___ VARA DO TRABALHO DE ${c} – ${e}`;
}

/** Linha para o prompt da redação; vazia fora da área trabalhista. */
export function regraEnderecamento(area: string | null | undefined): string {
  if (!ehAreaTrabalhista(area)) return '';
  return `ENDEREÇAMENTO (regra fixa do escritório para peça trabalhista): a 1ª linha da peça é exatamente "${enderecamentoTrabalhista()}", em maiúsculas. A vara fica "___". Troque (CIDADE) e (ESTADO) pela cidade e pela UF da Vara do Trabalho competente (local da prestação do serviço, art. 651 da CLT) só se constarem das fontes; senão, mantenha (CIDADE) e (ESTADO). Nunca use "EXCELENTÍSSIMO SENHOR JUIZ".`;
}

const limpar = (l: string) => l.replace(/[*_#]/g, '').trim();
const PARECE_ENDERECAMENTO = /^(EXCELENT|EXM|MERIT|ILUSTR|DOUT|SENHOR|SR\.?\s|AO\s|À\s|A\s+VARA)|\bJU[IÍ]Z/i;

/** Garante o cabeçalho padrão na peça trabalhista; outras áreas voltam intactas. */
export function aplicarEnderecamento(texto: string, area: string | null | undefined): string {
  const t = String(texto || '');
  if (!ehAreaTrabalhista(area)) return t;
  const linhas = t.split('\n');
  const i = linhas.findIndex((l) => l.trim());
  const primeira = i >= 0 ? limpar(linhas[i]) : '';
  if (i < 0 || primeira.length > 250 || !PARECE_ENDERECAMENTO.test(primeira)) {
    return `${enderecamentoTrabalhista()}\n\n${t}`;
  }
  // Cidade e UF do cabeçalho antigo ("… DE VITÓRIA/ES", "… DE SERRA – ES").
  const m = primeira.match(/.*\bDE\s+([^/–—-]+?)\s*[/–—-]\s*([A-Za-z]{2})\s*$/i);
  const cidade = m && !/^\(?CIDADE\)?$/i.test(m[1].trim()) ? m[1] : null;
  linhas[i] = enderecamentoTrabalhista(cidade, cidade ? m![2] : null);
  return linhas.join('\n');
}
