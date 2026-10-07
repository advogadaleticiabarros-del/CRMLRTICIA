// Pedido (07/10/2026): na linha da RPV da Kaylane (parceria Infinity Law) o
// A Receber mostrava R$ 3.997,04 — os 30% inteiros, metade é da parceira.
// "corrija para aparecer apenas o que é meu de direito". A coluna Valor passa
// a mostrar a SUA parte (x.seu, calculada por separarParceiro no servidor); o
// total só aparece em letra menor, como referência.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
const ini = src.indexOf('async function finReceitas(c)');
const bloco = src.slice(ini, src.indexOf('const awardForm', ini));

test('A Receber: coluna Valor mostra a sua parte (seu) quando o caso é parceria', () => {
  assert.match(bloco, /<td><strong>\$\{money\(Number\(x\.parceiro\) > 0 \? x\.seu : x\.valor\)\}<\/strong>/);
});

test('A Receber: o total com a parceira não aparece mais como valor principal da linha', () => {
  assert.doesNotMatch(bloco, /<td><strong>\$\{money\(x\.valor\)\}<\/strong>\$\{Number\(x\.parceiro\)/);
});
