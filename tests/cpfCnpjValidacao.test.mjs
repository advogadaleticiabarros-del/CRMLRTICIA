// tests/cpfCnpjValidacao.test.mjs
// Ideia 4 de prioridade alta da auditoria do módulo Clientes (23/09/2026):
// o campo cpf_cnpj aceitava qualquer texto, sem checar o dígito verificador.
// src/utils/cpfCnpj.ts implementa o algoritmo público (Receita Federal) e é
// testado aqui como função pura (sem precisar de banco) — depois isolado e
// avaliado com new Function(), padrão já usado neste projeto pra lógica sem
// dependência externa.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const utilPath = path.resolve('src/utils/cpfCnpj.ts');
const utilSrc = fs.readFileSync(utilPath, 'utf8');

// Transpila o TS mínimo necessário (só tipagem simples) pra rodar em JS puro:
// remove qualquer anotação ": tipo[| tipo...]" (parâmetros e retornos) e o
// `export` na frente da declaração — não há generics/interfaces aqui, então
// um strip genérico de tipos primitivos é suficiente.
function carregarFuncoes() {
  const jsSrc = utilSrc
    .replace(/export /g, '')
    .replace(/:\s*(string|number|boolean|null|undefined)(\s*\|\s*(string|number|boolean|null|undefined))*/g, '');
  const escopo = {};
  // eslint-disable-next-line no-new-func
  new Function('escopo', jsSrc + '\nescopo.normalizarDigitos = normalizarDigitos; escopo.cpfCnpjValido = cpfCnpjValido;')(escopo);
  return escopo;
}

test('normalizarDigitos remove pontuação e mantém só dígitos', () => {
  const { normalizarDigitos } = carregarFuncoes();
  assert.equal(normalizarDigitos('123.456.789-00'), '12345678900');
  assert.equal(normalizarDigitos('12.345.678/0001-95'), '12345678000195');
  assert.equal(normalizarDigitos(null), '');
  assert.equal(normalizarDigitos(undefined), '');
});

test('cpfCnpjValido aceita vazio (campo opcional)', () => {
  const { cpfCnpjValido } = carregarFuncoes();
  assert.equal(cpfCnpjValido(''), true);
  assert.equal(cpfCnpjValido(null), true);
  assert.equal(cpfCnpjValido(undefined), true);
});

test('cpfCnpjValido aceita CPF real (dígito verificador correto), com ou sem máscara', () => {
  const { cpfCnpjValido } = carregarFuncoes();
  // 111.444.777-35 é um CPF de teste amplamente usado (dígitos verificadores corretos)
  assert.equal(cpfCnpjValido('111.444.777-35'), true);
  assert.equal(cpfCnpjValido('11144477735'), true);
});

test('cpfCnpjValido rejeita CPF com dígito verificador errado', () => {
  const { cpfCnpjValido } = carregarFuncoes();
  assert.equal(cpfCnpjValido('111.444.777-36'), false);
  assert.equal(cpfCnpjValido('12345678900'), false);
});

test('cpfCnpjValido rejeita CPF com todos os dígitos iguais (ex.: 111.111.111-11)', () => {
  const { cpfCnpjValido } = carregarFuncoes();
  assert.equal(cpfCnpjValido('11111111111'), false);
});

test('cpfCnpjValido aceita CNPJ real (dígito verificador correto), com ou sem máscara', () => {
  const { cpfCnpjValido } = carregarFuncoes();
  // 11.222.333/0001-81 é um CNPJ de teste amplamente usado (dígitos corretos)
  assert.equal(cpfCnpjValido('11.222.333/0001-81'), true);
  assert.equal(cpfCnpjValido('11222333000181'), true);
});

test('cpfCnpjValido rejeita CNPJ com dígito verificador errado', () => {
  const { cpfCnpjValido } = carregarFuncoes();
  assert.equal(cpfCnpjValido('11.222.333/0001-82'), false);
});

test('cpfCnpjValido rejeita quantidade de dígitos que não é nem CPF (11) nem CNPJ (14)', () => {
  const { cpfCnpjValido } = carregarFuncoes();
  assert.equal(cpfCnpjValido('123'), false);
  assert.equal(cpfCnpjValido('123456789012'), false);
});

test('POST /api/clients rejeita CPF/CNPJ com dígito verificador inválido', () => {
  const src = fs.readFileSync(path.resolve('src/routes/clients.ts'), 'utf8');
  assert.match(src, /cpfCnpjValido/, 'clients.ts deveria importar e usar cpfCnpjValido');
  const idxPost = src.indexOf("router.post('/', async");
  const fimPost = src.indexOf('\n});', idxPost);
  assert.match(src.slice(idxPost, fimPost), /cpfCnpjValido/, 'POST deveria validar o CPF/CNPJ antes de salvar');
  const idxPut = src.indexOf("router.put('/:id'");
  const fimPut = src.indexOf('\n});', idxPut);
  assert.match(src.slice(idxPut, fimPut), /cpfCnpjValido/, 'PUT deveria validar o CPF/CNPJ antes de salvar');
});

test('SQL de clients.ts não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([path.resolve('src/routes/clients.ts')]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});
