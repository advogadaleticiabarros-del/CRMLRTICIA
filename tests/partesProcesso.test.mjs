// tests/partesProcesso.test.mjs — parte contrária e demais partes do processo
import { test } from 'node:test';
import assert from 'node:assert';
import { validarParte, ehParteDoCliente, POLOS } from '../dist/services/partesProcesso.js';

test('validarParte: parte contrária com CNPJ, advogado e OAB normalizados', () => {
  const { erro, dados } = validarParte({ papel: 'contraria', nome: '  Stilo Pet Ltda ', cpf_cnpj: '49969511000105', advogado: 'Fulano', advogado_oab: 'es 36027' });
  assert.strictEqual(erro, null);
  assert.strictEqual(dados.nome, 'STILO PET LTDA');
  assert.strictEqual(dados.cpf_cnpj, '49.969.511/0001-05');
  assert.strictEqual(dados.advogado_oab, 'ES36027');
  assert.strictEqual(dados.papel, 'contraria');
});

test('validarParte: CPF formatado e papel desconhecido vira "contraria"', () => {
  const { dados } = validarParte({ papel: 'xyz', nome: 'Leticia Gomes', cpf_cnpj: '120.116.947-01' });
  assert.strictEqual(dados.cpf_cnpj, '120.116.947-01');
  assert.strictEqual(dados.papel, 'contraria');
});

test('validarParte: nome é obrigatório', () => {
  assert.match(validarParte({ papel: 'testemunha', nome: ' ' }).erro, /nome/i);
});

test('ehParteDoCliente: impede cadastrar o próprio cliente como parte contrária', () => {
  assert.strictEqual(ehParteDoCliente({ cpf_cnpj: '120.116.947-01' }, { cpf_cnpj: '12011694701' }), true);
  assert.strictEqual(ehParteDoCliente({ nome: 'MARIA SILVA' }, { name: 'Maria  Silva' }), true);
  assert.strictEqual(ehParteDoCliente({ nome: 'EMPRESA X' }, { name: 'Maria Silva', cpf_cnpj: null }), false);
});

test('POLOS: cliente pode ser autor (ativo) ou réu (passivo)', () => {
  assert.deepStrictEqual(Object.keys(POLOS), ['ativo', 'passivo']);
});
