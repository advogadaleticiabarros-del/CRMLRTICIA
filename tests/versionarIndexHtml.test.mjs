// tests/versionarIndexHtml.test.mjs — Toda tela nova chega depois do deploy (30/10/2026).
// Caso real: a barra de progresso da Mesa do caso não apareceu para a Jessica depois
// da publicação, porque só app.js, whatsapp.js e portal-parceiro.js ganhavam ?v= e o
// navegador continuou com o mesa.js antigo.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { versionarIndexHtml } from '../dist/utils/versionarIndexHtml.js';

const html = `<link rel="stylesheet" href="/styles.css" />
<script src="/vendor/jspdf/jspdf.umd.min.js"></script>
<script src="/app.js"></script>
<script src="/socket.io/socket.io.js"></script>
<script src="/mesa.js"></script>
<script src="/loteCliente.js"></script>
<script src="https://cdn.exemplo.com/x.js"></script>`;

test('todo script da tela ganha ?v= do deploy (inclusive mesa.js e loteCliente.js)', () => {
  const out = versionarIndexHtml(html, '123');
  for (const f of ['app', 'mesa', 'loteCliente']) assert.ok(out.includes(`src="/${f}.js?v=123"`), f);
  assert.ok(out.includes('href="/styles.css?v=123"'));
});

test('bibliotecas, socket.io e endereços externos ficam como estão', () => {
  const out = versionarIndexHtml(html, '123');
  assert.ok(out.includes('src="/vendor/jspdf/jspdf.umd.min.js"'));
  assert.ok(out.includes('src="/socket.io/socket.io.js"'));
  assert.ok(out.includes('src="https://cdn.exemplo.com/x.js"'));
});

test('no index.html real, nenhum script próprio fica sem versão', () => {
  const out = versionarIndexHtml(fs.readFileSync('public/index.html', 'utf8'), '9');
  const semVersao = [...out.matchAll(/src="\/([\w-]+\.js)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(semVersao, []);
});
