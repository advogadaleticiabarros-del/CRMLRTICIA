// tests/nomeSimilarConflito.test.mjs
// Ideia 8 de prioridade média da auditoria do módulo Clientes (23/09/2026):
// a checagem de conflito de interesses (GET /api/clients/conflito) é busca
// de texto simples — não pega uma letra trocada nem acento diferente.
// src/utils/nomeSimilar.ts adiciona tolerância a erro de digitação por
// distância de edição (Levenshtein), testado aqui como função pura.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const utilPath = path.resolve('src/utils/nomeSimilar.ts');
const utilSrc = fs.readFileSync(utilPath, 'utf8');

function carregarFuncoes() {
  const jsSrc = utilSrc
    .replace(/export /g, '')
    .replace(/:\s*(string|number|boolean|null|undefined)(\s*\|\s*(string|number|boolean|null|undefined))*/g, '');
  const escopo = {};
  // eslint-disable-next-line no-new-func
  new Function('escopo', jsSrc + '\nescopo.normalizarNome = normalizarNome; escopo.levenshtein = levenshtein; escopo.nomesParecidos = nomesParecidos;')(escopo);
  return escopo;
}

test('normalizarNome tira acento, baixa caixa e espaços duplicados', () => {
  const { normalizarNome } = carregarFuncoes();
  assert.equal(normalizarNome('José  Antônio'), 'jose antonio');
  assert.equal(normalizarNome('  MARIA  '), 'maria');
});

test('levenshtein calcula a distância de edição corretamente', () => {
  const { levenshtein } = carregarFuncoes();
  assert.equal(levenshtein('ricardo', 'ricardo'), 0);
  assert.equal(levenshtein('ricardo', 'ricrado'), 2);
  assert.equal(levenshtein('', 'abc'), 3);
});

test('nomesParecidos aceita nome idêntico e com acento diferente', () => {
  const { nomesParecidos } = carregarFuncoes();
  assert.equal(nomesParecidos('José Antônio', 'jose antonio'), true);
});

test('nomesParecidos tolera 1 letra trocada num nome curto', () => {
  const { nomesParecidos } = carregarFuncoes();
  assert.equal(nomesParecidos('Ricardo', 'Ricrado'), true);
});

test('nomesParecidos NÃO trata nomes completamente diferentes como parecidos', () => {
  const { nomesParecidos } = carregarFuncoes();
  assert.equal(nomesParecidos('Ricardo Silva', 'Fernanda Souza'), false);
});

test('GET /conflito usa nomesParecidos pra dar tolerância a erro de digitação', () => {
  const routeSrc = fs.readFileSync(path.resolve('src/routes/clients.ts'), 'utf8');
  assert.match(routeSrc, /nomesParecidos/, 'rota /conflito deveria usar a nova função de comparação tolerante');
  const idx = routeSrc.indexOf("router.get('/conflito'");
  const fim = routeSrc.indexOf('\nrouter.', idx + 10);
  const bloco = routeSrc.slice(idx, fim);
  assert.match(bloco, /nomesParecidos/);
});

test('SQL de clients.ts não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([path.resolve('src/routes/clients.ts')]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});
