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

export async function montarKit(acao: AcaoMontada, cliente: string, deps: DepsKit): Promise<{ zip: Buffer; nome: string; incluidos: number; fora: string[] }> {
  const zip = new JSZip();
  const leia: string[] = [`Kit de protocolo — ${cliente}`, `Ação: ${acao.titulo || `caso #${acao.id}`}`, `Réu: ${acao.reu || 'não identificado'}`, ''];
  const fora: string[] = [];
  let incluidos = 0;

  if (acao.peca) {
    const p = await deps.arquivo(acao.peca.docId);
    if (p?.content) {
      zip.file(`00 - Petição inicial - ${limpar(acao.reu || cliente)}.docx`, await pecaParaDocx(p.content));
      leia.push(`00 - Petição inicial (v${acao.peca.versao}${acao.peca.final ? ', versão final' : ', AINDA NÃO MARCADA COMO FINAL'})`);
    }
  } else leia.push('00 - Petição inicial: ainda não gerada');

  leia.push('', 'Anexos, nesta ordem:');
  for (const item of acao.kit) {
    const a = await deps.arquivo(item.docId);
    if (!a?.data) {
      fora.push(item.nome);
      leia.push(`  ${item.nome}  ← NÃO INCLUÍDO: ${item.link ? `arquivo só no Drive (${item.link})` : 'documento sem arquivo guardado no CRM'}`);
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
