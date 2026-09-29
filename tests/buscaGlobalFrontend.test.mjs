// Achado real (29/09/2026): busca "lenta" e resultado só com o nome, sem dar
// pra clicar e ver tudo. Causas de UX no front (além da correção no backend):
// resposta antiga sobrescrevendo a nova (rede instável) e lista piscando a
// cada tecla. AbortController resolve a 1ª; manter o hint sem apagar a lista
// resolve a 2ª. Tocar no resultado precisa abrir a ficha completa de verdade.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
const ini = src.indexOf('let qsDebounce = null;');
const bloco = src.slice(ini, src.indexOf('\n// ── Painel de contexto', ini) === -1
  ? src.indexOf('function fichaCliente', ini) : src.indexOf('\n// ── Painel de contexto', ini));

test('busca cancela a requisição anterior com AbortController (evita resposta velha sobrescrever a nova)', () => {
  assert.match(bloco, /new AbortController\(\)/);
  assert.match(bloco, /signal: ctrl\.signal/);
  assert.match(bloco, /ctrl\.signal\.aborted/);
});

test('debounce ficou mais curto (200ms) e há um só timer ativo por vez', () => {
  assert.match(bloco, /setTimeout\(\(\) => runQuickSearch\(q\), 200\)/);
  assert.match(bloco, /clearTimeout\(qsDebounce\)/);
});

test('resultado do cliente mostra telefone/CPF, não só o nome', () => {
  assert.match(bloco, /qs-row-sub.*c\.phone, c\.cpf_cnpj/s);
});

test('cada linha do resultado indica visualmente que dá pra tocar (seta/chevron)', () => {
  assert.match(bloco, /qs-row-chevron/);
});

test('tocar no resultado abre a ficha completa (cliente) ou o detalhe (processo), com erro tratado', () => {
  assert.match(bloco, /fichaCliente\(b\.dataset\.qsClient\)\.catch/);
  assert.match(bloco, /caseDetail\(b\.dataset\.qsCase\)\.catch/);
});
