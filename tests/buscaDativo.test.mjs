// tests/buscaDativo.test.mjs
// Pedido da Dra. Letícia (16/11/2026): em Dativos, a busca também acha a
// demanda pelo número do processo, digitado com ou sem pontuação.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { filtroBuscaDativo } from '../dist/services/buscaDativo.js';

test('busca vazia não filtra nada', () => {
  assert.equal(filtroBuscaDativo(''), null);
  assert.equal(filtroBuscaDativo('   '), null);
  assert.equal(filtroBuscaDativo(undefined), null);
});

test('texto sem números procura só no nome do assistido', () => {
  const f = filtroBuscaDativo(' Maria ');
  assert.equal(f.sql, '(assisted_name LIKE ?)');
  assert.deepEqual(f.params, ['%Maria%']);
});

test('número com pontuação procura pelos dígitos, ignorando a pontuação gravada', () => {
  const f = filtroBuscaDativo('5001234-56.2025.8.08.0024');
  assert.match(f.sql, /assisted_name LIKE \?/);
  assert.match(f.sql, /REPLACE\(.*process_number/);
  assert.deepEqual(f.params, ['%5001234-56.2025.8.08.0024%', '%50012345620258080024%']);
});

test('número sem pontuação também acha (só dígitos)', () => {
  const f = filtroBuscaDativo('50012345620258080024');
  assert.deepEqual(f.params, ['%50012345620258080024%', '%50012345620258080024%']);
});

test('trecho do número (a partir de 4 dígitos) acha; 1 a 3 dígitos não viram busca de processo', () => {
  assert.deepEqual(filtroBuscaDativo('0024').params.slice(1), ['%0024%']);
  assert.equal(filtroBuscaDativo('12').params.length, 1);
});

test('rota GET /cases usa o filtro e a tela manda o parâmetro busca', () => {
  const rota = fs.readFileSync('src/routes/dative.ts', 'utf8');
  const front = fs.readFileSync('public/app.js', 'utf8');
  assert.match(rota, /filtroBuscaDativo\(/);
  assert.match(front, /params\.set\('busca'/);
  assert.match(front, /número do processo/);
});
