// tests/juncaoManual.test.mjs — junção escolhida pela Dra. na tela do cliente (Jessica, 31/10/2026):
// "a junção manual pode misturar teses diferentes (empréstimo consignado com cartão
// RMC/RCC) apenas, não os réus". A sugestão automática continua só com a mesma tese;
// à mão, a Dra. pode juntar teses diferentes, mas sempre contra o MESMO banco.
import { test } from 'node:test';
import assert from 'node:assert';
import { conferirJuncao, montarLote } from '../dist/services/loteProducao.js';
import { conferirPecasPorBanco } from '../dist/services/contratosDoCaso.js';

const caso = (id, titulo, banco, extra = {}) => ({
  id, client_id: 7, production_stage: 'separacao_documentos', titulo,
  partes: banco ? [{ nome: banco, cpf_cnpj: null }] : [], ...extra,
});

test('junta empréstimo consignado e cartão RMC/RCC do mesmo banco (teses diferentes)', () => {
  assert.strictEqual(conferirJuncao([
    caso(1, 'Empréstimo consignado — Banco Itaú', 'Banco Itaú S.A.'),
    caso(2, 'RMC — Itaú', 'ITAU S/A'),
  ]), null);
});

test('reconhece o mesmo banco pela raiz do CNPJ, mesmo com nomes diferentes', () => {
  assert.strictEqual(conferirJuncao([
    caso(1, 'Empréstimo consignado', null, { partes: [{ nome: 'Itaú Unibanco S.A.', cpf_cnpj: '60.701.190/0001-04' }] }),
    caso(2, 'Cartão consignado', null, { partes: [{ nome: 'Unibanco S.A.', cpf_cnpj: '60.701.190/4816-09' }] }),
  ]), null);
});

test('bancos diferentes nunca juntam: cada banco é uma peça', () => {
  const erro = conferirJuncao([
    caso(1, 'Empréstimo consignado — Banco Itaú', 'Banco Itaú S.A.'),
    caso(2, 'Empréstimo consignado — Banco Pine', 'Banco Pine S.A.'),
  ]);
  assert.match(erro, /mesmo banco/);
  assert.match(erro, /Pine/);
});

test('ação sem réu identificado não junta (não dá para conferir o banco)', () => {
  assert.match(conferirJuncao([caso(1, 'Empréstimo consignado', 'Banco Pan S.A.'), caso(2, 'Cartão consignado', null)]), /parte contrária/);
});

test('precisa de duas ações, do mesmo cliente, antes do protocolo', () => {
  assert.match(conferirJuncao([caso(1, 'RMC — Pan', 'Banco Pan')]), /duas/);
  assert.match(conferirJuncao([caso(1, 'RMC — Pan', 'Banco Pan'), caso(2, 'RCC — Pan', 'Banco Pan', { client_id: 8 })]), /mesmo cliente/);
  assert.match(conferirJuncao([caso(1, 'RMC — Pan', 'Banco Pan'), caso(2, 'RCC — Pan', 'Banco Pan', { production_stage: 'protocolado' })]), /protocolad/);
});

test('conferência por banco: cartão do Itaú unido à ação de empréstimo do Itaú está coberto', () => {
  const ct = { id: 1, chave: 'n:9', case_id: null, fora: false, dados: { numero: '9', tipo: 'rmc', banco: 'Banco Itaú S.A.' } };
  const separado = conferirPecasPorBanco([ct], [{ id: 1, titulo: 'Empréstimo consignado — Itaú', reus: [{ nome: 'Banco Itaú S.A.' }] }]);
  assert.deepStrictEqual(separado.problemas.map((p) => p.tipo), ['falta_acao'], 'sem a junção, o cartão não tem ação');
  const unido = conferirPecasPorBanco([ct], [{ id: 1, titulo: 'Empréstimo consignado — Itaú', titulos: ['RMC — Itaú'], reus: [{ nome: 'Banco Itaú S.A.' }] }]);
  assert.deepStrictEqual(unido.problemas, []);
  assert.deepStrictEqual(unido.bancos[0].acoes, [1]);
});

test('tela do cliente: a ação mostra as teses e os pedidos unidos a ela', () => {
  const lote = montarLote({
    cliente: 'Cliente Teste',
    acoes: [{ id: 1, titulo: 'Empréstimo consignado — Banco Itaú', production_stage: 'criacao_inicial', case_number: null, legal_area: 'consumidor',
      partes: [{ nome: 'Banco Itaú S.A.', cpf_cnpj: null }], unidos: [{ id: 2, titulo: 'RMC — Itaú' }] }],
    documentos: [],
  });
  const a = lote.acoes[0];
  assert.deepStrictEqual(a.familias, ['emprestimo_consignado', 'cartao_consignado']);
  assert.strictEqual(a.nomeFamilia, 'Empréstimo consignado + Cartão consignado (RMC/RCC)');
  assert.deepStrictEqual(a.unidos, [{ id: 2, titulo: 'RMC — Itaú' }]);
});
