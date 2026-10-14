/**
 * Cérebro: a biblioteca do escritório. Lê o cofre do Obsidian da Dra.
 * (notas, modelos, fichas de clientes, manual), responde a quem perguntar
 * buscando com o contexto (cliente, processo, área) e entrega aos outros
 * agentes o trecho certo. Também aponta o que organizar no cofre.
 *
 * Regras puras (tests/cerebro.test.mjs). Banco e IA ficam em cerebroServico.ts.
 */
import crypto from 'crypto';

export interface Nota {
  caminho: string;
  titulo: string;
  pasta: string;
  tags: string[];
  links: string[];
  conteudo: string;
  hash: string;
}

export interface Trecho {
  id: number;
  titulo: string;
  pasta: string;
  texto: string;
  caminho?: string;
  vetor?: number[] | null;
}

export interface Contexto { cliente?: string | null; processo?: string | null; area?: string | null }

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Arquivos fora da leitura: configuração do Obsidian, lixeira, pastas ocultas e o que não é .md. */
export function deveIgnorar(caminho: string): boolean {
  const c = caminho.replace(/\\/g, '/');
  if (!/\.md$/i.test(c)) return true;
  return c.split('/').some((p) => p.startsWith('.'));
}

export function lerNota(caminho: string, texto: string): Nota {
  const c = caminho.replace(/\\/g, '/');
  const bruto = String(texto || '');
  const fm = bruto.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const corpo = fm ? bruto.slice(fm[0].length) : bruto;
  const tags = new Set<string>();
  if (fm) {
    const emLinha = fm[1].match(/^tags:[ \t]*(\S.*)$/m);
    if (emLinha) {
      const lista = emLinha[1].trim();
      const itens = lista.startsWith('[') ? lista.replace(/[[\]]/g, '').split(',') : lista.split(/[,\s]+/);
      for (const t of itens) { const v = t.trim().replace(/^#/, ''); if (v) tags.add(v); }
    }
    const emLista = fm[1].match(/^tags:[ \t]*\n((?:[ \t]*-[ \t]*.+\n?)+)/m);
    if (emLista) for (const l of emLista[1].split('\n')) { const v = l.replace(/^[ \t]*-[ \t]*/, '').trim().replace(/^#/, ''); if (v) tags.add(v); }
  }
  for (const m of corpo.matchAll(/(?:^|\s)#([\p{L}\d_/-]+)/gu)) tags.add(m[1]);
  const links = [...new Set([...corpo.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim()))];
  const partes = c.split('/');
  const arquivo = partes.pop() || c;
  return {
    caminho: c,
    titulo: arquivo.replace(/\.md$/i, ''),
    pasta: partes.join('/'),
    tags: [...tags],
    links,
    conteudo: corpo.trim(),
    hash: crypto.createHash('sha256').update(bruto).digest('hex'),
  };
}

/** Corta a nota em trechos de até `max` caracteres, por parágrafo; cada trecho começa com o título. */
export function dividirEmTrechos(titulo: string, conteudo: string, max = 1200): string[] {
  const texto = String(conteudo || '').trim();
  if (!texto) return [];
  const paragrafos = texto.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let atual = '';
  const fecha = () => { if (atual.trim()) out.push(`${titulo}\n${atual.trim()}`); atual = ''; };
  for (const p of paragrafos) {
    if (p.length > max) {
      fecha();
      for (let i = 0; i < p.length; i += max) out.push(`${titulo}\n${p.slice(i, i + max)}`);
      continue;
    }
    if ((atual + '\n\n' + p).length > max) fecha();
    atual = atual ? `${atual}\n\n${p}` : p;
  }
  fecha();
  return out;
}

const PALAVRAS_VAZIAS = new Set(['a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'para', 'por', 'com', 'que', 'qual', 'quais', 'como', 'se', 'ao', 'aos', 'sobre', 'tem', 'ha', 'mais', 'me', 'eu', 'ele', 'ela']);
function palavras(t: string): string[] {
  return semAcento(t).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !PALAVRAS_VAZIAS.has(w));
}

function cosseno(a: number[], b: number[]): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/**
 * Busca híbrida: palavras em comum (título pesa mais), significado (vetor,
 * quando houver) e reforço do contexto (cliente, processo, área). Só volta o
 * que tem alguma relação com a pergunta.
 */
export function buscarTrechos(consulta: string, ctx: Contexto, trechos: Trecho[], vetorConsulta: number[] | null, limite = 6): Array<Trecho & { pontos: number }> {
  const q = palavras(consulta);
  const ctxPalavras = palavras([ctx.cliente, ctx.processo, ctx.area].filter(Boolean).join(' '));
  const ctxDigitos = String(ctx.processo || '').replace(/\D/g, '');
  const out: Array<Trecho & { pontos: number }> = [];
  for (const t of trechos) {
    const corpo = new Set(palavras(t.texto));
    const titulo = new Set(palavras(t.titulo));
    let pts = 0;
    for (const w of q) { if (titulo.has(w)) pts += 2; else if (corpo.has(w)) pts += 1; }
    const lexico = q.length ? pts / q.length : 0;
    let ctxPts = 0;
    for (const w of ctxPalavras) if (titulo.has(w) || corpo.has(w)) ctxPts += titulo.has(w) ? 1 : 0.5;
    if (ctxDigitos.length >= 7 && t.texto.replace(/\D/g, '').includes(ctxDigitos)) ctxPts += 2;
    const sim = vetorConsulta && t.vetor ? cosseno(vetorConsulta, t.vetor) : 0;
    if (lexico <= 0 && sim < 0.35) continue;
    const total = lexico + (sim >= 0.35 ? sim * 2 : 0) + ctxPts * 0.8;
    out.push({ ...t, pontos: Math.round(total * 1000) / 1000 });
  }
  return out.sort((a, b) => b.pontos - a.pontos).slice(0, limite);
}

export interface RelatorioCofre {
  totalNotas: number;
  pastas: Array<{ pasta: string; notas: number }>;
  linksQuebrados: Array<{ nota: string; link: string }>;
  orfas: string[];
  semTags: string[];
  vazias: string[];
  titulosRepetidos: Array<{ titulo: string; caminhos: string[] }>;
  /** Nota-índice pronta para salvar no Obsidian: uma seção por pasta, com [[links]]. */
  mapaDoCofre: string;
}

/** O que organizar no cofre do Obsidian. */
export function analisarCofre(notas: Nota[]): RelatorioCofre {
  const porTitulo = new Map<string, Nota[]>();
  for (const n of notas) {
    const k = semAcento(n.titulo);
    porTitulo.set(k, [...(porTitulo.get(k) || []), n]);
  }
  const alvos = (link: string) => porTitulo.get(semAcento(link.split('/').pop() || link).replace(/\.md$/, '')) || [];
  const recebeLink = new Set<string>();
  const linksQuebrados: RelatorioCofre['linksQuebrados'] = [];
  for (const n of notas) {
    for (const l of n.links) {
      const a = alvos(l);
      if (!a.length) linksQuebrados.push({ nota: n.caminho, link: l });
      for (const alvo of a) recebeLink.add(alvo.caminho);
    }
  }
  const contagem = new Map<string, number>();
  for (const n of notas) contagem.set(n.pasta || '(raiz)', (contagem.get(n.pasta || '(raiz)') || 0) + 1);
  const pastas = [...contagem.entries()].map(([pasta, q]) => ({ pasta, notas: q })).sort((a, b) => b.notas - a.notas);
  const mapa = ['# Mapa do cofre', '', '_Gerado pelo Cérebro do CRM: todas as notas, por pasta._', ''];
  for (const { pasta } of [...pastas].sort((a, b) => a.pasta.localeCompare(b.pasta))) {
    mapa.push(`## ${pasta}`);
    for (const n of notas.filter((x) => (x.pasta || '(raiz)') === pasta).sort((a, b) => a.titulo.localeCompare(b.titulo))) mapa.push(`- [[${n.titulo}]]`);
    mapa.push('');
  }
  return {
    totalNotas: notas.length,
    pastas,
    linksQuebrados,
    orfas: notas.filter((n) => n.conteudo && !n.links.length && !recebeLink.has(n.caminho)).map((n) => n.caminho),
    semTags: notas.filter((n) => n.conteudo && !n.tags.length).map((n) => n.caminho),
    vazias: notas.filter((n) => !n.conteudo).map((n) => n.caminho),
    titulosRepetidos: [...porTitulo.values()].filter((v) => v.length > 1).map((v) => ({ titulo: v[0].titulo, caminhos: v.map((n) => n.caminho).sort() })),
    mapaDoCofre: mapa.join('\n'),
  };
}

const fonte = (t: Trecho) => t.caminho || `${t.pasta ? t.pasta + '/' : ''}${t.titulo}.md`;

export function montarPromptCerebro(pergunta: string, ctx: Contexto, trechos: Trecho[]): string {
  const c = [ctx.cliente && `cliente ${ctx.cliente}`, ctx.processo && `processo ${ctx.processo}`, ctx.area && `área ${ctx.area}`].filter(Boolean).join(', ');
  return `Você é o Cérebro, a biblioteca do escritório de advocacia da Dra. Letícia Barros.
Responda à pergunta usando SOMENTE as notas do escritório abaixo. Cite a fonte de cada informação entre parênteses, com o caminho da nota.
Se as notas não responderem, diga claramente "não encontrei isso na biblioteca" e sugira o que cadastrar no Obsidian. Não invente.
${c ? `Contexto de quem pergunta: ${c}.` : ''}
Responda em português simples, direto, em até 10 linhas.

PERGUNTA: ${pergunta}

NOTAS DO ESCRITÓRIO:
${trechos.map((t, i) => `[${i + 1}] (${fonte(t)})\n${t.texto}`).join('\n\n')}`;
}

/** Bloco que outros agentes (ex.: Estagiário) colocam no próprio prompt. */
export function blocoParaAgente(trechos: Trecho[]): string {
  if (!trechos.length) return '';
  return `\n\nBIBLIOTECA DO ESCRITÓRIO (notas do Obsidian trazidas pelo Cérebro: referência da casa; use só o que se aplicar a este caso):
${trechos.map((t) => `— (${fonte(t)}) ${t.texto.slice(0, 1200)}`).join('\n')}\n`;
}
