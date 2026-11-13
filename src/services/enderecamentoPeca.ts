/**
 * Endereçamento (cabeçalho) da petição inicial — regras da Jessica:
 * - toda peça abre com "AO DOUTO JUÍZO" (13/11/2026), seguido do juízo competente;
 * - na trabalhista o cabeçalho é fixo (30/10/2026):
 *     "AO DOUTO JUÍZO DA ___ VARA DO TRABALHO DE (CIDADE) – (ESTADO)"
 *   A vara fica em branco (sai na distribuição). Cidade e estado entram quando se sabe;
 *   senão ficam os marcadores (CIDADE) e (ESTADO) para a Dra. preencher.
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
  return `AO DOUTO JUÍZO DA ___ VARA DO TRABALHO DE ${c} – ${e}`;
}

/** Linha para o prompt da redação da petição inicial. */
export function regraEnderecamento(area: string | null | undefined): string {
  if (!ehAreaTrabalhista(area)) {
    return 'ENDEREÇAMENTO (regra fixa do escritório): a 1ª linha da peça começa com "AO DOUTO JUÍZO", em maiúsculas, seguido do juízo competente (ex.: "AO DOUTO JUÍZO DA ___ VARA CÍVEL DA COMARCA DE (CIDADE) – (ESTADO)", "AO DOUTO JUÍZO DO JUIZADO ESPECIAL FEDERAL DE (CIDADE) – (ESTADO)"). Nunca use "EXCELENTÍSSIMO SENHOR JUIZ".';
  }
  return `ENDEREÇAMENTO (regra fixa do escritório para peça trabalhista): a 1ª linha da peça é exatamente "${enderecamentoTrabalhista()}", em maiúsculas. A vara fica "___". Troque (CIDADE) e (ESTADO) pela cidade e pela UF da Vara do Trabalho competente (local da prestação do serviço, art. 651 da CLT) só se constarem das fontes; senão, mantenha (CIDADE) e (ESTADO). Nunca use "EXCELENTÍSSIMO SENHOR JUIZ".`;
}

// Tira a marcação de markdown (negrito, título); o "___" da vara fica.
const limpar = (l: string) => l.replace(/[*#]/g, '').trim().replace(/^(_+)(.+)\1$/, '$2').trim();
const PARECE_ENDERECAMENTO = /^(EXCELENT|EXM|MERIT|ILUSTR|DOUT|SENHOR|SR\.?\s|AO\s|À\s|A\s+VARA)|\bJU[IÍ]Z/i;
// Tudo até "JUIZ"/"JUÍZO" (com "DE DIREITO"/"FEDERAL" do juiz), trocado por "AO DOUTO JUÍZO".
const ATE_JUIZO = /^.*?\bJU[IÍ]ZO?\b(?:\s+(?:DE\s+DIREITO|FEDERAL)\b)?/i;
// "AO JUIZADO…", "À 2ª VARA…": falta o "DOUTO JUÍZO".
const SEM_JUIZO = /^(AO|À|A)\s+((?:JUIZADO|VARA|\d).*)$/i;

/** "AO DOUTO JUÍZO" no início do endereçamento das outras áreas; o juízo escrito pela IA fica. */
function abrirComDouto(linha: string): string | null {
  if (ATE_JUIZO.test(linha)) return linha.replace(ATE_JUIZO, 'AO DOUTO JUÍZO');
  const m = linha.match(SEM_JUIZO);
  if (m) return `AO DOUTO JUÍZO ${m[1].toUpperCase() === 'AO' ? 'DO' : 'DA'} ${m[2]}`;
  return null;
}

/** Garante o cabeçalho padrão na petição inicial (fixo na trabalhista; "AO DOUTO JUÍZO" nas outras). */
export function aplicarEnderecamento(texto: string, area: string | null | undefined): string {
  const t = String(texto || '');
  const linhas = t.split('\n');
  const i = linhas.findIndex((l) => l.trim());
  const primeira = i >= 0 ? limpar(linhas[i]) : '';
  const pareceEnderecamento = i >= 0 && primeira.length <= 250 && PARECE_ENDERECAMENTO.test(primeira);

  if (!ehAreaTrabalhista(area)) {
    const nova = pareceEnderecamento ? abrirComDouto(primeira) : null;
    if (!nova) return t;
    linhas[i] = nova;
    return linhas.join('\n');
  }

  if (!pareceEnderecamento) return `${enderecamentoTrabalhista()}\n\n${t}`;
  // Cidade e UF do cabeçalho antigo ("… DE VITÓRIA/ES", "… DE SERRA – ES").
  const m = primeira.match(/.*\bDE\s+([^/–—-]+?)\s*[/–—-]\s*([A-Za-z]{2})\s*$/i);
  const cidade = m && !/^\(?CIDADE\)?$/i.test(m[1].trim()) ? m[1] : null;
  linhas[i] = enderecamentoTrabalhista(cidade, cidade ? m![2] : null);
  return linhas.join('\n');
}
