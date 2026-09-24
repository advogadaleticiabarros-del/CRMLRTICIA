/**
 * Comparação de nomes tolerante a grafia diferente — achado da auditoria do
 * módulo Clientes (23/09/2026): a checagem de conflito de interesses hoje é
 * busca de texto simples (substring), que não pega uma letra trocada ("Ricrado"
 * em vez de "Ricardo") nem acento diferente. Não resolve apelido nem nome de
 * solteira/casada (isso exigiria um dicionário de sinônimos, fora de escopo
 * aqui) — só tolerância a erro de digitação por distância de edição.
 */

export function normalizarNome(s: string | null | undefined): string {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acento
    .toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Distância de Levenshtein (nº mínimo de inserções/remoções/trocas pra transformar a em b). */
export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const linha = new Array(n + 1);
  for (let j = 0; j <= n; j++) linha[j] = j;
  for (let i = 1; i <= m; i++) {
    let anterior = linha[0];
    linha[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = linha[j];
      linha[j] = a[i - 1] === b[j - 1]
        ? anterior
        : 1 + Math.min(anterior, linha[j], linha[j - 1]);
      anterior = temp;
    }
  }
  return linha[n];
}

/**
 * Dois nomes são "parecidos" se a distância de edição entre eles for pequena
 * em relação ao tamanho — tolera 1 erro de digitação em nomes curtos e até 2
 * em nomes mais longos, sem virar um casamento frouxo demais (que devolveria
 * gente com nome completamente diferente como "parecido").
 */
export function nomesParecidos(a: string, b: string): boolean {
  const na = normalizarNome(a), nb = normalizarNome(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const maiorTam = Math.max(na.length, nb.length);
  const tolerancia = maiorTam <= 6 ? 1 : maiorTam <= 14 ? 2 : 3;
  return levenshtein(na, nb) <= tolerancia;
}
