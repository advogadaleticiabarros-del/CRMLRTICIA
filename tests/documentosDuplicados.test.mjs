// tests/documentosDuplicados.test.mjs — documentos repetidos do cliente (31/10/2026, caso do
// Valmirio: 52 documentos, o mesmo histórico de créditos várias vezes e 39 anexos no kit).
// Jessica: "quando atualizo a pasta deve vir apenas os documentos que não estão, caso
// contrário terá excesso de documentos, kit incorreto e vamos gastar mais com leituras".
// Mesmo arquivo = mesmo arquivo do Drive (ID) ou mesmo conteúdo (md5), em qualquer ação do cliente.
import { test } from 'node:test';
import assert from 'node:assert';
import { chavesDoDocumento, planoDeLimpeza, semDuplicados } from '../dist/services/documentosDuplicados.js';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const link = (id) => `https://drive.google.com/file/d/${id}/view`;
const d = (id, extra = {}) => ({ id, case_id: 110, name: `arquivo ${id}.pdf`, file_url: null, md5: null, tem_texto: true, ...extra });

test('SQL dos documentos repetidos não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos(['src/services/documentosDuplicadosMysql.ts']);
  assert.deepStrictEqual(tabelasInexistentes, []);
  assert.deepStrictEqual(colunasInexistentes, []);
});

test('chaves: o ID do arquivo no Drive e o conteúdo (md5); documento sem nenhum dos dois não tem chave', () => {
  assert.deepStrictEqual(chavesDoDocumento(d(1, { file_url: link('AbC_1'), md5: 'ABCDEF' })), ['drive:AbC_1', 'md5:abcdef']);
  assert.deepStrictEqual(chavesDoDocumento(d(2)), []);
});

test('o mesmo arquivo do Drive em 6 ações vira um só, guardado no cliente (vale para todas)', () => {
  const docs = [110, 111, 112, 113, 114, 115].map((caso, i) => d(10 + i, { case_id: caso, file_url: link('hiscre24') }));
  const p = planoDeLimpeza(docs);
  assert.deepStrictEqual(p.duplicados.map((x) => x.id), [11, 12, 13, 14, 15]);
  assert.ok(p.duplicados.every((x) => x.de === 10));
  assert.deepStrictEqual(p.paraOCliente, [10]);
});

test('cópias com nome diferente e o mesmo conteúdo ("(2)", "(3)") ficam uma só, na mesma ação', () => {
  const docs = [
    d(1, { name: 'Histórico (2).pdf', file_url: link('a'), md5: 'm1' }),
    d(2, { name: 'Histórico (3).pdf', file_url: link('b'), md5: 'm1' }),
    d(3, { name: 'historico-creditos (25).pdf', file_url: link('c'), md5: 'm2' }),
  ];
  const p = planoDeLimpeza(docs);
  assert.deepStrictEqual(p.duplicados, [{ id: 2, de: 1 }]);
  assert.deepStrictEqual(p.paraOCliente, []);
});

test('fica o que já tem o texto lido (a leitura não é refeita)', () => {
  const p = planoDeLimpeza([d(1, { file_url: link('x'), tem_texto: false }), d(2, { file_url: link('x'), tem_texto: true })]);
  assert.deepStrictEqual(p.duplicados, [{ id: 1, de: 2 }]);
});

test('liga pelo caminho: A e B têm o mesmo ID; B e C o mesmo conteúdo → os três são o mesmo', () => {
  const p = planoDeLimpeza([d(1, { file_url: link('x') }), d(2, { file_url: link('x'), md5: 'h' }), d(3, { file_url: link('y'), md5: 'h' })]);
  assert.deepStrictEqual(p.duplicados.map((x) => x.id).sort(), [2, 3]);
});

test('peças, planilhas e versões geradas pelo CRM nunca entram (cada versão é própria)', () => {
  const p = planoDeLimpeza([
    d(1, { name: 'Petição Inicial — Fulano (v1)', md5: 'z' }),
    d(2, { name: 'Petição Inicial — Fulano (v2)', md5: 'z' }),
    d(3, { name: 'Planilha de cálculos (v1)', md5: 'w', type: 'ia' }),
    d(4, { name: 'Planilha de cálculos (v1)', md5: 'w', type: 'ia' }),
  ]);
  assert.deepStrictEqual(p.duplicados, []);
});

test('já marcado como repetido não volta a ser o original nem é contado de novo', () => {
  const p = planoDeLimpeza([d(1, { file_url: link('x') }), d(2, { file_url: link('x'), duplicado_de: 1 })]);
  assert.deepStrictEqual(p.duplicados, []);
});

test('semDuplicados: a lista da tela e do kit mostra cada arquivo uma vez, mesmo antes da limpeza', () => {
  const docs = [d(1, { file_url: link('x') }), d(2, { file_url: link('x') }), d(3, { duplicado_de: 1 }), d(4)];
  assert.deepStrictEqual(semDuplicados(docs).map((x) => x.id), [1, 4]);
});
