import { db } from '../config/database';
import { aiEmbed, aiComplete } from './aiAssistant';
import { registrarAcaoAgente } from './usoIa';
import {
  lerNota, dividirEmTrechos, buscarTrechos, analisarCofre, montarPromptCerebro, blocoParaAgente, deveIgnorar,
  type Contexto, type Nota, type Trecho,
} from './cerebro';

/**
 * Cérebro com banco e IA: guarda o cofre do Obsidian (cerebro_notas /
 * cerebro_trechos), calcula o vetor de cada trecho em segundo plano e
 * responde perguntas. As regras ficam em cerebro.ts.
 */

const DIMENSOES = 256;

// Trechos em memória para a busca (o cofre cabe com folga com vetores de 256).
let cache: { em: number; trechos: Trecho[] } | null = null;
const esquecer = () => { cache = null; };
async function trechos(): Promise<Trecho[]> {
  if (cache && Date.now() - cache.em < 10 * 60_000) return cache.trechos;
  const [rows] = await db.query(
    `SELECT t.id, t.texto, t.embedding, n.titulo, n.pasta, n.caminho
       FROM cerebro_trechos t JOIN cerebro_notas n ON n.id = t.nota_id`) as any;
  const lista: Trecho[] = rows.map((r: any) => ({
    id: r.id, texto: r.texto, titulo: r.titulo, pasta: r.pasta, caminho: r.caminho,
    vetor: r.embedding ? (typeof r.embedding === 'string' ? JSON.parse(r.embedding) : r.embedding) : null,
  }));
  cache = { em: Date.now(), trechos: lista };
  return lista;
}

/** Recebe um lote de notas do cofre (caminho + texto). Só reprocessa o que mudou. */
export async function importarNotas(lote: Array<{ caminho: string; texto: string }>) {
  let novas = 0, atualizadas = 0, iguais = 0, ignoradas = 0;
  for (const item of lote) {
    if (!item?.caminho || deveIgnorar(item.caminho)) { ignoradas++; continue; }
    const n = lerNota(item.caminho, String(item.texto || '').slice(0, 2_000_000));
    const [[ex]] = await db.query('SELECT id, hash FROM cerebro_notas WHERE caminho = ?', [n.caminho]) as any;
    if (ex && ex.hash === n.hash) { iguais++; continue; }
    let notaId: number;
    if (ex) {
      await db.query('UPDATE cerebro_notas SET titulo = ?, pasta = ?, tags = ?, links = ?, conteudo = ?, hash = ? WHERE id = ?',
        [n.titulo, n.pasta, JSON.stringify(n.tags), JSON.stringify(n.links), n.conteudo, n.hash, ex.id]);
      await db.query('DELETE FROM cerebro_trechos WHERE nota_id = ?', [ex.id]);
      notaId = ex.id; atualizadas++;
    } else {
      const [r] = await db.query('INSERT INTO cerebro_notas (caminho, titulo, pasta, tags, links, conteudo, hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [n.caminho, n.titulo, n.pasta, JSON.stringify(n.tags), JSON.stringify(n.links), n.conteudo, n.hash]) as any;
      notaId = r.insertId; novas++;
    }
    const partes = dividirEmTrechos(n.titulo, n.conteudo);
    for (let i = 0; i < partes.length; i++) {
      await db.query('INSERT INTO cerebro_trechos (nota_id, ordem, texto) VALUES (?, ?, ?)', [notaId, i, partes[i]]);
    }
  }
  if (novas || atualizadas) esquecer();
  return { novas, atualizadas, iguais, ignoradas };
}

/** Apaga as notas que saíram do cofre (lista completa de caminhos enviada no fim da importação). */
export async function removerAusentes(caminhos: string[]): Promise<number> {
  const manter = new Set(caminhos.map((c) => c.replace(/\\/g, '/')));
  const [rows] = await db.query('SELECT id, caminho FROM cerebro_notas') as any;
  const apagar = rows.filter((r: any) => !manter.has(r.caminho)).map((r: any) => r.id);
  for (let i = 0; i < apagar.length; i += 200) {
    const parte = apagar.slice(i, i + 200);
    await db.query(`DELETE FROM cerebro_notas WHERE id IN (${parte.map(() => '?').join(',')})`, parte);
  }
  if (apagar.length) esquecer();
  return apagar.length;
}

/** Calcula o vetor de significado dos trechos que ainda não têm (rotina cerebro:indexar). */
export async function indexarPendentes(limite = 200): Promise<{ indexados: number; faltam: number }> {
  const [rows] = await db.query('SELECT id, texto FROM cerebro_trechos WHERE embedding IS NULL LIMIT ?', [limite]) as any;
  let indexados = 0;
  for (const r of rows) {
    const v = await aiEmbed(r.texto, DIMENSOES);
    if (!v) break; // sem chave ou IA fora do ar: tenta na próxima rodada
    await db.query('UPDATE cerebro_trechos SET embedding = ? WHERE id = ?', [JSON.stringify(v.map((x) => Math.round(x * 1e5) / 1e5)), r.id]);
    indexados++;
  }
  const [[f]] = await db.query('SELECT COUNT(*) AS n FROM cerebro_trechos WHERE embedding IS NULL') as any;
  if (indexados) esquecer();
  return { indexados, faltam: Number(f?.n || 0) };
}

async function buscar(texto: string, ctx: Contexto, limite: number) {
  const lista = await trechos();
  if (!lista.length) return [];
  const vetor = lista.some((t) => t.vetor) ? await aiEmbed([texto, ctx.cliente, ctx.area].filter(Boolean).join(' '), DIMENSOES) : null;
  return buscarTrechos(texto, ctx, lista, vetor, limite);
}

/** Pergunta ao Cérebro: busca nas notas e responde citando as fontes. */
export async function perguntarAoCerebro(pergunta: string, ctx: Contexto, quem = 'equipe') {
  const achados = await buscar(pergunta, ctx, 6);
  registrarAcaoAgente('cerebro', `respondeu ${quem}: "${pergunta.slice(0, 80)}"`);
  const fontes = achados.map((t) => ({ caminho: t.caminho, titulo: t.titulo, trecho: t.texto.slice(0, 400) }));
  if (!achados.length) return { resposta: 'Não encontrei isso na biblioteca. Vale cadastrar uma nota sobre o assunto no Obsidian e atualizar o Cérebro.', fontes };
  const r = await aiComplete(montarPromptCerebro(pergunta, ctx, achados), 'openai');
  return { resposta: r.ok && r.text ? r.text : 'A IA está fora do ar agora; estas são as notas mais próximas da pergunta.', fontes };
}

/** Trechos da biblioteca para outro agente colocar no próprio prompt (sem gastar IA de resposta). */
export async function contextoDoCerebro(texto: string, ctx: Contexto, quem: string, limite = 3): Promise<string> {
  try {
    const achados = await buscar(texto.slice(0, 2000), ctx, limite);
    if (achados.length) registrarAcaoAgente('cerebro', `repassou ${achados.length} nota(s) da biblioteca para ${quem}`);
    return blocoParaAgente(achados);
  } catch { return ''; }
}

export async function relatorioOrganizacao() {
  const [rows] = await db.query('SELECT caminho, titulo, pasta, tags, links, conteudo, hash FROM cerebro_notas') as any;
  const parse = (v: any) => (Array.isArray(v) ? v : (() => { try { return JSON.parse(v || '[]'); } catch { return []; } })());
  const notas: Nota[] = rows.map((r: any) => ({ caminho: r.caminho, titulo: r.titulo, pasta: r.pasta, tags: parse(r.tags), links: parse(r.links), conteudo: r.conteudo, hash: r.hash }));
  return analisarCofre(notas);
}

export async function resumoCerebro() {
  const [[n]] = await db.query('SELECT COUNT(*) AS notas, MAX(atualizado_em) AS ultima FROM cerebro_notas') as any;
  const [[t]] = await db.query('SELECT COUNT(*) AS total, SUM(embedding IS NOT NULL) AS indexados FROM cerebro_trechos') as any;
  return { notas: Number(n?.notas || 0), ultimaAtualizacao: n?.ultima || null, trechos: Number(t?.total || 0), indexados: Number(t?.indexados || 0) };
}
