// tests/kitProtocolo.test.mjs — kit de protocolo de uma ação (card único do cliente, 30/10/2026):
// .zip com a peça em Word, os anexos renomeados na ordem e as fotos convertidas em PDF.
import { test } from 'node:test';
import assert from 'node:assert';
import JSZip from 'jszip';
import { montarKit } from '../dist/services/kitProtocolo.js';

// PNG 1x1 válido.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const acao = {
  id: 114, titulo: 'RCC — Banco Teste S.A.', reu: 'Banco Teste S.A.', production_stage: 'revisao_inicial', case_number: null, legal_area: 'consumidor', partes: [],
  familia: 'cartao_consignado', nomeFamilia: 'Cartão consignado (RMC/RCC)', situacao: 'revisar', planilha: null,
  peca: { docId: 1, versao: 2, final: false, nome: 'Petição Inicial — Fulano (v2)' },
  kit: [
    { docId: 2, nome: '01 - Procuração - Fulano.pdf', tipo: 'procuracao', original: 'PROC.pdf', temArquivo: true, link: null, imagem: false },
    { docId: 3, nome: '02 - Consulta de cartões e empréstimos - Fulano.pdf', tipo: 'consulta_consignados', original: 'print.png', temArquivo: true, link: null, imagem: true },
    { docId: 4, nome: '03 - Comprovante de residência - Fulano.pdf', tipo: 'comprovante_residencia', original: 'luz.pdf', temArquivo: false, link: 'https://drive.example/x', imagem: false },
  ],
  faltam: [{ tipo: 'extrato_emprestimos', rotulo: 'Extrato de empréstimos consignados do INSS', bloqueia: true, motivo: 'liga cada desconto ao banco' }],
};
const arquivos = {
  1: { data: null, mime: null, content: 'EXCELENTÍSSIMO SENHOR DOUTOR JUIZ\n\nFulano, já qualificado, vem propor ação.' },
  2: { data: Buffer.from('%PDF-1.4 procuracao'), mime: 'application/pdf', content: null },
  3: { data: PNG, mime: 'image/png', content: null },
};

test('kit: peça em .docx, anexos com o nome padrão, foto em PDF e LEIA-ME com o que ficou fora e o que falta', async () => {
  const r = await montarKit(acao, 'Fulano', { arquivo: async (id) => arquivos[id] || null });
  const zip = await JSZip.loadAsync(r.zip);
  const nomes = Object.keys(zip.files).sort();
  assert.deepStrictEqual(nomes, ['00 - Petição inicial - Banco Teste S.A..docx', '01 - Procuração - Fulano.pdf', '02 - Consulta de cartões e empréstimos - Fulano.pdf', 'LEIA-ME.txt']);
  const foto = await zip.file('02 - Consulta de cartões e empréstimos - Fulano.pdf').async('nodebuffer');
  assert.strictEqual(foto.subarray(0, 4).toString(), '%PDF', 'a foto virou PDF');
  const docx = await JSZip.loadAsync(await zip.file('00 - Petição inicial - Banco Teste S.A..docx').async('nodebuffer'));
  const xml = await docx.file('word/document.xml').async('string');
  assert.ok(xml.includes('Times New Roman') && xml.includes('vem propor ação'));
  const leia = await zip.file('LEIA-ME.txt').async('string');
  assert.ok(leia.includes('AINDA NÃO MARCADA COMO FINAL'));
  assert.ok(leia.includes('03 - Comprovante de residência - Fulano.pdf  ← NÃO INCLUÍDO: não deu para baixar do Drive'));
  assert.ok(leia.includes('Extrato de empréstimos consignados do INSS (OBRIGATÓRIO)'));
  assert.strictEqual(r.incluidos, 2);
  assert.strictEqual(r.nome, 'Kit Fulano x Banco Teste S.A..zip');
});

// Pedido de 30/10/2026: "caso eu faça a revisão e tenha a peça aprimorada, quero incluir
// a peça como V FINAL... e depois baixar os kits".
import { textoDoDocx, pecaParaDocx, idDoArquivoNoDrive } from '../dist/services/kitProtocolo.js';

test('peça enviada em Word: o texto é lido parágrafo a parágrafo (revisão e conferência continuam lendo)', async () => {
  const docx = await pecaParaDocx('EXCELENTÍSSIMO SENHOR JUIZ\n\nFulano vem propor ação & pedir R$ 1.000,00.');
  const t = await textoDoDocx(docx);
  assert.ok(t.includes('EXCELENTÍSSIMO SENHOR JUIZ'));
  assert.ok(t.includes('Fulano vem propor ação & pedir R$ 1.000,00.'));
  assert.strictEqual(await textoDoDocx(Buffer.from('não é docx')), null);
});

test('kit: a versão final enviada pela Dra. vai como ela mandou (o arquivo original, não um Word refeito)', async () => {
  const original = Buffer.from('%PDF-1.4 peça revisada pela Dra.');
  const a = { ...acao, peca: { docId: 9, versao: 3, final: true, nome: 'Petição Inicial — Fulano (v3 · versão final da Dra.)' }, kit: [] };
  const r = await montarKit(a, 'Fulano', { arquivo: async (id) => (id === 9 ? { data: original, mime: 'application/pdf', content: null } : null) });
  const zip = await JSZip.loadAsync(r.zip);
  const nome = Object.keys(zip.files).find((n) => n.startsWith('00 - '));
  assert.strictEqual(nome, '00 - Petição inicial - Banco Teste S.A..pdf');
  assert.deepStrictEqual(await zip.file(nome).async('nodebuffer'), original);
  assert.ok((await zip.file('LEIA-ME.txt').async('string')).includes('v3, versão final'));
});

test('arquivo que está só no Google Drive: o id sai do link para o kit baixar', () => {
  assert.strictEqual(idDoArquivoNoDrive('https://drive.google.com/file/d/1AbC_x-9/view'), '1AbC_x-9');
  assert.strictEqual(idDoArquivoNoDrive('https://drive.google.com/open?id=1AbC_x-9'), '1AbC_x-9');
  assert.strictEqual(idDoArquivoNoDrive('https://exemplo.com/x.pdf'), null);
  assert.strictEqual(idDoArquivoNoDrive(null), null);
});
