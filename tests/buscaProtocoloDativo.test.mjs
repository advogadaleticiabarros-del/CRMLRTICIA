// Pedido da Jessica (16/11/2026): "coloque um campo de pesquisa por protocolo"
// na lista de demandas dativas. Acha pelo protocolo do e-Flow digitado em
// maiúscula ou minúscula, com ou sem hífen/espaço, inteiro ou só um pedaço.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { filtroProtocoloDativo } from '../dist/services/buscaDativo.js';

test('protocolo vazio não filtra nada', () => {
  assert.equal(filtroProtocoloDativo(''), null);
  assert.equal(filtroProtocoloDativo('  - '), null);
  assert.equal(filtroProtocoloDativo(undefined), null);
  assert.equal(filtroProtocoloDativo(123), null);
});

test('normaliza o que foi digitado: maiúsculas, sem hífen nem espaço', () => {
  assert.deepEqual(filtroProtocoloDativo('2026-c35xph').params, ['%2026C35XPH%']);
  assert.deepEqual(filtroProtocoloDativo(' 2026 C35XPH ').params, ['%2026C35XPH%']);
  assert.deepEqual(filtroProtocoloDativo('c35x').params, ['%C35X%']);
});

test('compara com o protocolo gravado também normalizado', () => {
  const { sql } = filtroProtocoloDativo('2026-C35XPH');
  assert.match(sql, /UPPER\(REPLACE\(REPLACE\(eflow_protocolo, '-', ''\), ' ', ''\)\) LIKE \?/);
});

test('caracteres de curinga do LIKE digitados não viram curinga', () => {
  assert.deepEqual(filtroProtocoloDativo('20%26_x').params, ['%2026X%']);
});

test('rota e tela usam o campo de protocolo', () => {
  const rota = fs.readFileSync('src/routes/dative.ts', 'utf8');
  assert.match(rota, /filtroProtocoloDativo\(req\.query\.protocolo\)/);
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(app, /id="dcase-protocolo"/);
  assert.match(app, /params\.set\('protocolo'/);
});
