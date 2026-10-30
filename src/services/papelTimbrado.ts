import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

/**
 * Peça no papel timbrado da Dra., na formatação das peças (pedido de 30/10/2026: "eu só
 * quero colar lá, para que deixe no papel timbrado e deixe na formatação correta para peças").
 *
 * Formatação que ela cobra: Times New Roman 12, espaçamento 1,5, justificado, recuo de
 * 2,5 cm na 1ª linha; endereçamento e títulos em negrito e centralizados; citação com recuo
 * de 4 cm e letra 10; fecho, data e assinatura presos uns aos outros (não quebram de página).
 *
 * O modelo é `assets/timbrado/papel-timbrado.docx`: o "PAPEL TIMBRADO.docx" da Dra. com o
 * corpo vazio (o cabeçalho traz a página inteira do timbrado: logo, marca d'água e rodapé).
 * Aqui só se troca o corpo e se mantém a seção (margens e cabeçalho).
 * Testes em tests/papelTimbrado.test.mjs.
 */

export interface Trecho { t: string; b?: boolean; i?: boolean; u?: boolean }
export type TipoBloco = 'p' | 'titulo' | 'citacao' | 'item';
export type Alinhamento = '' | 'left' | 'center' | 'right' | 'justify';
export interface Paragrafo { tipo: TipoBloco; alinhamento: Alinhamento; runs: Trecho[] }

export type Estilo = 'titulo' | 'corpo' | 'citacao' | 'item' | 'fecho';
export interface ParagrafoFormatado extends Paragrafo { estilo: Estilo; prender: boolean; espacoAssinatura?: boolean }

const TIPOS: TipoBloco[] = ['p', 'titulo', 'citacao', 'item'];
const ALINHAMENTOS: Alinhamento[] = ['', 'left', 'center', 'right', 'justify'];
const MAX_PARAGRAFOS = 3000, MAX_TRECHOS = 300, MAX_TEXTO = 200_000;

/** O que vem da tela é só dado: tipos e alinhamentos conhecidos, texto e três marcações. */
export function validarParagrafos(entrada: unknown): Paragrafo[] {
  if (!Array.isArray(entrada)) throw new Error('A peça deve vir como lista de parágrafos');
  if (entrada.length > MAX_PARAGRAFOS) throw new Error('Peça longa demais');
  let total = 0;
  const out: Paragrafo[] = [];
  for (const bruto of entrada as any[]) {
    const runs: Trecho[] = [];
    for (const r of (Array.isArray(bruto?.runs) ? bruto.runs : []).slice(0, MAX_TRECHOS)) {
      if (typeof r?.t !== 'string' || !r.t) continue;
      total += r.t.length;
      const tr: Trecho = { t: r.t };
      if (r.b) tr.b = true;
      if (r.i) tr.i = true;
      if (r.u) tr.u = true;
      runs.push(tr);
    }
    if (total > MAX_TEXTO) throw new Error('Peça longa demais');
    if (!runs.some((r) => r.t.trim())) continue;
    out.push({
      tipo: TIPOS.includes(bruto?.tipo) ? bruto.tipo : 'p',
      alinhamento: ALINHAMENTOS.includes(bruto?.alinhamento) ? bruto.alinhamento : '',
      runs,
    });
  }
  if (!out.length) throw new Error('A peça está vazia');
  return out;
}

/** Texto puro (a peça da equipe, ou colado sem formatação): uma linha por parágrafo; **x** = negrito. */
export function paragrafosDoTexto(texto: string): Paragrafo[] {
  return String(texto || '').replace(/\r/g, '').split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trimEnd())
    .filter((l) => l.trim())
    .map((l) => {
      const runs: Trecho[] = [];
      l.split(/(\*\*[^*]+\*\*)/).forEach((pedaco) => {
        if (!pedaco) return;
        const m = pedaco.match(/^\*\*([^*]+)\*\*$/);
        runs.push(m ? { t: m[1], b: true } : { t: pedaco });
      });
      return { tipo: 'p' as TipoBloco, alinhamento: '' as Alinhamento, runs };
    });
}

const textoDo = (p: Paragrafo) => p.runs.map((r) => r.t).join('').trim();

/** Linha de título: tudo em maiúsculas (as letras), curta. Ex.: endereçamento, "I – DOS FATOS", "DOS PEDIDOS". */
function ehTitulo(t: string): boolean {
  const letras = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  return letras.length >= 3 && t.length <= 200 && letras === letras.toUpperCase();
}

const FECHO = /^(nestes|nesses|neste|nesse)\s+termos|^termos\s+em\s+que|^pede(-se)?\s+deferimento|^n\.\s*termos/i;
const DATA = /^[A-Za-zÀ-ÿ .'-]{3,40}(\/[A-Za-z]{2})?,\s*\d{1,2}(º)?\s+de\s+[a-zç]+\s+de\s+\d{4}/i;

export function formatarPeca(paragrafos: Paragrafo[]): ParagrafoFormatado[] {
  const ps = paragrafos.filter((p) => textoDo(p));
  // Fecho: do "Nestes termos" (ou, sem ele, da data) até o fim, olhando só o final da peça.
  let inicioFecho = -1;
  const janela = Math.max(0, ps.length - 12);
  for (let i = ps.length - 1; i >= janela; i--) if (FECHO.test(textoDo(ps[i]))) { inicioFecho = i; break; }
  if (inicioFecho < 0) for (let i = ps.length - 1; i >= janela; i--) if (DATA.test(textoDo(ps[i]))) { inicioFecho = i; break; }
  return ps.map((p, i) => {
    const t = textoDo(p);
    const estilo: Estilo = inicioFecho >= 0 && i >= inicioFecho ? 'fecho'
      : p.tipo === 'citacao' ? 'citacao'
        : p.tipo === 'item' ? 'item'
          : p.tipo === 'titulo' || ehTitulo(t) ? 'titulo' : 'corpo';
    // A linha depois da data é o nome de quem assina: espaço para a assinatura.
    const espacoAssinatura = estilo === 'fecho' && i > 0 && DATA.test(textoDo(ps[i - 1]));
    return { ...p, estilo, prender: estilo === 'fecho' ? i < ps.length - 1 : estilo === 'titulo', ...(espacoAssinatura ? { espacoAssinatura } : {}) };
  });
}

// ── .docx ───────────────────────────────────────────────────────────────────

const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const JC: Record<string, string> = { left: 'left', center: 'center', right: 'right', justify: 'both' };

function runXml(r: Trecho, estilo: Estilo): string {
  const tam = estilo === 'citacao' ? 20 : 24;
  const negrito = r.b || estilo === 'titulo';
  const rPr = `<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>${negrito ? '<w:b/><w:bCs/>' : ''}${r.i ? '<w:i/><w:iCs/>' : ''}${r.u ? '<w:u w:val="single"/>' : ''}<w:sz w:val="${tam}"/><w:szCs w:val="${tam}"/><w:lang w:val="pt-BR"/></w:rPr>`;
  const partes = r.t.split(/(\n|\t)/).map((x) => (x === '\n' ? '<w:br/>' : x === '\t' ? '<w:tab/>' : x ? `<w:t xml:space="preserve">${escXml(x)}</w:t>` : '')).join('');
  return `<w:r>${rPr}${partes}</w:r>`;
}

function paragrafoXml(p: ParagrafoFormatado): string {
  const padrao: Record<Estilo, { jc: string; ind: string; antes: number; depois: number; linha: number }> = {
    corpo: { jc: 'both', ind: '<w:ind w:firstLine="1417"/>', antes: 0, depois: 120, linha: 360 },
    titulo: { jc: 'center', ind: '<w:ind w:firstLine="0"/>', antes: 240, depois: 240, linha: 360 },
    citacao: { jc: 'both', ind: '<w:ind w:left="2268"/>', antes: 120, depois: 240, linha: 240 },
    item: { jc: 'both', ind: '<w:ind w:left="709" w:hanging="283"/>', antes: 0, depois: 120, linha: 360 },
    fecho: { jc: 'center', ind: '<w:ind w:firstLine="0"/>', antes: 0, depois: 0, linha: 360 },
  };
  const e = padrao[p.estilo];
  const jc = (p.alinhamento && JC[p.alinhamento]) || e.jc;
  const prender = p.prender ? '<w:keepNext/><w:keepLines/>' : '';
  const antes = p.espacoAssinatura ? 720 : e.antes;
  const pPr = `<w:pPr>${prender}<w:spacing w:before="${antes}" w:after="${e.depois}" w:line="${e.linha}" w:lineRule="auto"/>${e.ind}<w:jc w:val="${jc}"/></w:pPr>`;
  return `<w:p>${pPr}${p.runs.map((r) => runXml(r, p.estilo)).join('')}</w:p>`;
}

const MODELO = path.join(__dirname, '..', '..', 'assets', 'timbrado', 'papel-timbrado.docx');
let modeloCache: Buffer | null = null;

/** A peça formatada dentro do papel timbrado (.docx). */
export async function docxNoTimbrado(paragrafos: ParagrafoFormatado[]): Promise<Buffer> {
  modeloCache = modeloCache || fs.readFileSync(MODELO);
  const z = await JSZip.loadAsync(modeloCache);
  const xml = await z.file('word/document.xml')!.async('string');
  const secao = xml.match(/<w:sectPr[\s\S]*<\/w:sectPr>/)?.[0] || '';
  const corpo = paragrafos.map(paragrafoXml).join('');
  z.file('word/document.xml', xml.replace(/<w:body>[\s\S]*<\/w:body>/, `<w:body>${corpo}${secao}</w:body>`));
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Texto puro da peça (para a revisão, a conferência dos valores e a busca). */
export const textoDosParagrafos = (ps: Paragrafo[]) => ps.map(textoDo).join('\n\n');
