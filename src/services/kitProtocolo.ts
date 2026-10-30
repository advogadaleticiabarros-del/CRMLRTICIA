import JSZip from 'jszip';
import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx';
import type { AcaoMontada } from './loteProducao';

/**
 * Kit de protocolo de UMA ação (card único do cliente, 30/10/2026): um .zip com
 *  - "00 - Petição inicial - <réu>.docx" (Times 12, espaçamento 1,5, recuo de 2,5 cm),
 *    para revisar no Word ou copiar para o Jusbrasil;
 *  - os anexos na ordem do protocolo, já renomeados ("01 - Procuração - Cliente.pdf"),
 *    com as fotos convertidas em PDF (o PJe pede PDF);
 *  - "LEIA-ME.txt" com a ordem, o que ficou de fora (arquivo só no Drive) e o que falta.
 * Banco entra por `DepsKit`; testes em tests/kitProtocolo.test.mjs.
 */

export interface ArquivoKit { data: Buffer | null; mime: string | null; content: string | null }
export interface DepsKit { arquivo(docId: number): Promise<ArquivoKit | null> }

/** Foto → PDF de uma página A4, com a imagem inteira e margem de 1 cm. */
export function imagemParaPdf(img: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 28 });
    const partes: Buffer[] = [];
    pdf.on('data', (b: Buffer) => partes.push(b));
    pdf.on('end', () => resolve(Buffer.concat(partes)));
    pdf.on('error', reject);
    try {
      pdf.image(img, 28, 28, { fit: [595.28 - 56, 841.89 - 56], align: 'center', valign: 'center' });
      pdf.end();
    } catch (e) { reject(e); }
  });
}

const ehTitulo = (l: string) => l.length <= 120 && /[A-ZÀ-Ú]/.test(l) && l === l.toUpperCase();

/** Peça em texto → .docx no padrão do escritório (Times New Roman 12, 1,5, recuo 2,5 cm). */
export async function pecaParaDocx(texto: string): Promise<Buffer> {
  const linhas = String(texto || '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\*\*/g, '').replace(/^#+\s*/, '').trimEnd());
  const paragrafos = linhas.map((l) => {
    const t = l.trim();
    if (!t) return new Paragraph({ children: [] });
    const titulo = ehTitulo(t);
    return new Paragraph({
      alignment: titulo ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
      indent: titulo ? undefined : { firstLine: 1417 },
      spacing: { line: 360 },
      children: [new TextRun({ text: t, bold: titulo, font: 'Times New Roman', size: 24 })],
    });
  });
  const doc = new Document({ sections: [{ properties: { page: { margin: { top: 1701, bottom: 1134, left: 1701, right: 1134 } } }, children: paragrafos }] });
  return Packer.toBuffer(doc);
}

const limpar = (s: string) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Texto de um .docx (a peça revisada que a Dra. envia), um parágrafo por linha. Não é .docx: null. */
export async function textoDoDocx(buf: Buffer): Promise<string | null> {
  try {
    const z = await JSZip.loadAsync(buf);
    const xml = await z.file('word/document.xml')?.async('string');
    if (!xml) return null;
    const ent = (t: string) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    const paragrafos = xml.split(/<\/w:p>/).map((p) =>
      ent((p.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>|<w:tab\/>|<w:br\/>/g) || [])
        .map((t) => (t.startsWith('<w:tab') ? '\t' : t.startsWith('<w:br') ? '\n' : t.replace(/<[^>]+>/g, ''))).join('')));
    const texto = paragrafos.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return texto || null;
  } catch { return null; }
}

/** Id do arquivo num link do Google Drive (/file/d/<id>/ ou ?id=<id>). */
export function idDoArquivoNoDrive(url: string | null | undefined): string | null {
  const u = String(url || '');
  if (!/drive\.google\.com/.test(u)) return null;
  const m = u.match(/\/file\/d\/([\w-]+)/) || u.match(/[?&]id=([\w-]+)/);
  return m ? m[1] : null;
}

const EXT_PECA: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
};

export async function montarKit(acao: AcaoMontada, cliente: string, deps: DepsKit): Promise<{ zip: Buffer; nome: string; incluidos: number; fora: string[] }> {
  const zip = new JSZip();
  const leia: string[] = [`Kit de protocolo — ${cliente}`, `Ação: ${acao.titulo || `caso #${acao.id}`}`, `Réu: ${acao.reu || 'não identificado'}`, ''];
  const fora: string[] = [];
  let incluidos = 0;

  if (acao.peca) {
    const p = await deps.arquivo(acao.peca.docId);
    const rotulo = `00 - Petição inicial (v${acao.peca.versao}${acao.peca.final ? ', versão final' : ', AINDA NÃO MARCADA COMO FINAL'})`;
    // A versão que a Dra. enviou (Word ou PDF) vai como ela mandou; a da equipe vira Word no padrão do escritório.
    if (p?.data && EXT_PECA[String(p.mime)]) {
      zip.file(`00 - Petição inicial - ${limpar(acao.reu || cliente)}.${EXT_PECA[String(p.mime)]}`, p.data);
      leia.push(`${rotulo}, arquivo enviado pela Dra.`);
    } else if (p?.content) {
      zip.file(`00 - Petição inicial - ${limpar(acao.reu || cliente)}.docx`, await pecaParaDocx(p.content));
      leia.push(rotulo);
    }
  } else leia.push('00 - Petição inicial: ainda não gerada');

  leia.push('', 'Anexos, nesta ordem:');
  for (const item of acao.kit) {
    const a = await deps.arquivo(item.docId);
    if (!a?.data) {
      fora.push(item.nome);
      leia.push(`  ${item.nome}  ← NÃO INCLUÍDO: ${item.link ? `não deu para baixar do Drive (${item.link})` : 'documento sem arquivo guardado no CRM'}`);
      continue;
    }
    let dados = a.data;
    if (item.imagem) {
      try { dados = await imagemParaPdf(a.data); } catch { fora.push(item.nome); leia.push(`  ${item.nome}  ← NÃO INCLUÍDO: a foto não pôde ser convertida em PDF`); continue; }
    }
    zip.file(item.nome, dados);
    incluidos++;
    leia.push(`  ${item.nome}   (original: ${item.original})`);
  }
  if (acao.faltam.length) {
    leia.push('', 'Falta juntar:');
    for (const f of acao.faltam) leia.push(`  - ${f.rotulo}${f.bloqueia ? ' (OBRIGATÓRIO)' : ''}: ${f.motivo}`);
  }
  zip.file('LEIA-ME.txt', leia.join('\r\n'));
  const nome = `Kit ${limpar(cliente)} x ${limpar(acao.reu || `caso ${acao.id}`)}.zip`;
  return { zip: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), nome, incluidos, fora };
}
