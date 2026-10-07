// tests/fichaUnica.test.mjs — uma pessoa = uma ficha
import { test } from 'node:test';
import assert from 'node:assert';
import { normalizarNome, escolherFichaExistente, ehVariasPessoas } from '../dist/services/fichaUnica.js';

const fichas = [
  { id: 1, name: 'DILMA PEREIRA DOS SANTOS', cpf_cnpj: null, phone: null, email: null },
  { id: 7, name: 'KAYLANE VITORIA MIRANDA LIMA', cpf_cnpj: '226.363.437-17', phone: null, email: null },
  { id: 28, name: 'Adriana Martins Moreira', cpf_cnpj: null, phone: '(27) 99999-1234', email: 'adri@x.com' },
  { id: 113, name: 'Jessica Caroline R Cardoso', cpf_cnpj: '068.132.439-26', phone: null, email: null },
];

test('normalizarNome: ignora acento, maiúscula, pontuação e espaços', () => {
  assert.strictEqual(normalizarNome('  Kaylane  Vitória Miranda-Lima '), 'KAYLANE VITORIA MIRANDA LIMA');
});

test('acha por CPF, mesmo com nome diferente (Jessica / Jessica Caroline)', () => {
  assert.strictEqual(escolherFichaExistente(fichas, { nome: 'Jessica', cpf: '06813243926' })?.id, 113);
});

test('acha por nome sem acento/maiúscula', () => {
  assert.strictEqual(escolherFichaExistente(fichas, { nome: 'Kaylane Vitória Miranda Lima' })?.id, 7);
});

test('mesmo nome mas CPF diferente → são pessoas diferentes (não junta)', () => {
  assert.strictEqual(escolherFichaExistente(fichas, { nome: 'KAYLANE VITORIA MIRANDA LIMA', cpf: '111.111.111-11' }), null);
});

test('acha por telefone (+ mesmo primeiro nome) e por e-mail', () => {
  assert.strictEqual(escolherFichaExistente(fichas, { nome: 'Adriana M. Moreira', phone: '5527999991234' })?.id, 28);
  assert.strictEqual(escolherFichaExistente(fichas, { nome: 'Outra Pessoa', phone: '5527999991234' }), null);
  assert.strictEqual(escolherFichaExistente(fichas, { nome: 'A. Moreira', email: 'ADRI@x.com' })?.id, 28);
});

test('ninguém parecido → null (pode criar)', () => {
  assert.strictEqual(escolherFichaExistente(fichas, { nome: 'Fulano de Tal', cpf: '123.456.789-09' }), null);
});

test('ehVariasPessoas: nomes juntos numa ficha só', () => {
  assert.strictEqual(ehVariasPessoas('LUNA GABRIELLY DOS SANTOS TERRA; ANA PAULA DOS SANTOS MAIA TERRA'), true);
  assert.strictEqual(ehVariasPessoas('WENDEL LEIVINO DIAS e MIRIAN DIAS SILVA'), true);
  assert.strictEqual(ehVariasPessoas('João Miguel, Camilli e Aila Vitória'), true);
  assert.strictEqual(ehVariasPessoas('STILU BELLE BOLSAS, CALCADOS LTDA'), false); // empresa
  assert.strictEqual(ehVariasPessoas('MARIA DAS GRACAS E SILVA'), false);              // "E" dentro do nome
  assert.strictEqual(ehVariasPessoas('KAYLANE VITORIA MIRANDA LIMA'), false);
});
