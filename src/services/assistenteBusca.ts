/**
 * Busca tolerante a erro de digitação para o assistente do WhatsApp (08/10/2026):
 * "mesmo que eu escreva errado ele consiga entender". Compara palavra a palavra
 * por semelhança (distância de edição), sem acento e sem caixa. Puro — testado
 * em tests/assistenteBusca.test.mjs.
 */

export function normalizar(s: string): string {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os']);
const palavras = (s: string) => normalizar(s).split(' ').filter((w) => w.length >= 2 && !PARTICULAS.has(w));

/** Distância de edição com transposição (Damerau): "maira" → "maria" = 1. */
function distancia(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length; const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + custo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

/** 0..1 — semelhança entre duas palavras (fonética simples: ç/s/z, ss/s, ch/x, y/i). */
function simPalavra(a: string, b: string): number {
  const f = (w: string) => w.replace(/ch/g, 'x').replace(/ss/g, 's').replace(/qu(?=[ei])/g, 'k').replace(/c(?=[aou])/g, 'k')
    .replace(/[cz](?=[ei])/g, 's').replace(/z/g, 's').replace(/y/g, 'i').replace(/ph/g, 'f').replace(/h/g, '');
  if (a === b || f(a) === f(b)) return 1;
  if (a.length >= 3 && b.startsWith(a)) return 0.95; // "luc" → "lucas"
  const A = f(a); const B = f(b);
  return 1 - distancia(A, B) / Math.max(A.length, B.length);
}

/** Cada palavra buscada precisa achar par no texto; nota = média dos melhores pares. */
export function semelhanca(busca: string, texto: string): number {
  const pb = palavras(busca); const pt = palavras(texto);
  if (!pb.length || !pt.length) return 0;
  const notas = pb.map((w) => Math.max(...pt.map((t) => simPalavra(w, t))));
  return notas.reduce((s, x) => s + x, 0) / notas.length;
}

/**
 * Desempate por posição: quem digita "ana maira" quer o nome em que a 2ª palavra
 * buscada é a 2ª do nome (Ana MARIA da Silva), não a 4ª (Ana Paula dos Santos MAIA).
 */
function bonusPosicao(busca: string, nome: string): number {
  const pb = palavras(busca); const pt = palavras(nome);
  const ok = pb.filter((w, i) => pt[i] && simPalavra(w, pt[i]) >= LIMIAR).length;
  return pb.length ? 0.2 * (ok / pb.length) : 0;
}

const LIMIAR = 0.78;

export function encontrarClientes<T extends { id: number; name: string }>(busca: string, lista: T[]): { unico: T | null; opcoes: T[] } {
  const notas = lista.map((c) => ({ c, s: semelhanca(busca, c.name) })).filter((x) => x.s >= LIMIAR)
    .map((x) => ({ c: x.c, s: x.s + bonusPosicao(busca, x.c.name) })).sort((a, b) => b.s - a.s);
  if (!notas.length) return { unico: null, opcoes: [] };
  const [p, seg] = notas;
  const destaque = !seg || p.s - seg.s >= 0.08;
  return { unico: destaque ? p.c : null, opcoes: notas.slice(0, 5).map((x) => x.c) };
}

export interface ContaAberta { id: number; descricao: string; valor: number; vencimento: string | null }

/** Conta a pagar em aberto pela descrição (com erro) e/ou valor. */
export function escolherConta<T extends ContaAberta>(pedido: { descricao: string; valor: number | null }, contas: T[]): { unico: T | null; opcoes: T[] } {
  let cands = contas;
  if (pedido.valor) {
    const mesmoValor = contas.filter((c) => Math.abs(Number(c.valor) - Number(pedido.valor)) < 0.011);
    if (mesmoValor.length) cands = mesmoValor;
    else if (!pedido.descricao) return { unico: null, opcoes: [] };
  }
  if (!pedido.descricao) return cands.length === 1 ? { unico: cands[0], opcoes: cands } : { unico: null, opcoes: cands.slice(0, 5) };
  const notas = cands.map((c) => ({ c, s: semelhanca(pedido.descricao, c.descricao) })).filter((x) => x.s >= 0.7).sort((a, b) => b.s - a.s);
  if (!notas.length) return { unico: null, opcoes: [] };
  const [p, seg] = notas;
  return { unico: !seg || p.s - seg.s >= 0.08 ? p.c : null, opcoes: notas.slice(0, 5).map((x) => x.c) };
}

/** Palavras que identificam cada tipo de documento (o pedido pode vir com sinônimo). */
const SINONIMOS: Record<string, string[]> = {
  procuracao: ['procuracao'],
  contrato: ['contrato', 'honorarios'],
  inicial: ['inicial', 'peticao'],
  sentenca: ['sentenca'],
  rg: ['rg', 'identidade', 'cnh', 'documento pessoal'],
  residencia: ['residencia', 'endereco'],
  declaracao: ['declaracao', 'hipossuficiencia'],
  acordo: ['acordo'],
  ata: ['ata', 'audiencia'],
  comprovante: ['comprovante', 'pagamento'],
};

export function escolherDocumento<T extends { id: number; name: string; type?: string | null }>(pedido: string, docs: T[]): T | null {
  const p = normalizar(pedido);
  if (!p) return null;
  // grupo de sinônimos que o pedido menciona (tolerante a erro)
  const grupo = Object.entries(SINONIMOS).find(([, ws]) => ws.some((w) => semelhanca(w, p) >= 0.8 || palavras(p).some((x) => simPalavra(x, w) >= 0.8)));
  const termos = grupo ? grupo[1] : [p];
  let melhor: { d: T; s: number } | null = null;
  for (const d of docs) {
    const alvo = `${d.name} ${String(d.type || '').replace(/_/g, ' ')}`;
    const s = Math.max(...termos.map((t) => semelhanca(t, alvo)));
    if (s >= 0.8 && (!melhor || s > melhor.s)) melhor = { d, s };
  }
  return melhor ? melhor.d : null;
}
