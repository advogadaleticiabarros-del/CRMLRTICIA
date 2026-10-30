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
  assert.ok(leia.includes('03 - Comprovante de residência - Fulano.pdf  ← NÃO INCLUÍDO: arquivo só no Drive'));
  assert.ok(leia.includes('Extrato de empréstimos consignados do INSS (OBRIGATÓRIO)'));
  assert.strictEqual(r.incluidos, 2);
  assert.strictEqual(r.nome, 'Kit Fulano x Banco Teste S.A..zip');
});
