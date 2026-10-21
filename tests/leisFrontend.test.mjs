// tests/leisFrontend.test.mjs — tela Pesquisa de Leis ligada ao CRM
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const js = fs.readFileSync(path.resolve('public/leis.js'), 'utf8');
const app = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
const html = fs.readFileSync(path.resolve('public/index.html'), 'utf8');

test('leis.js é JavaScript válido e registra a rota leis', () => {
  assert.doesNotThrow(() => new vm.Script(js));
  assert.match(js, /Object\.assign\(ROUTES,\s*\{[\s\S]*async leis\(page\)/);
  for (const rota of ['/api/leis/estado', '/api/leis/buscar', '/api/leis/norma/', '/api/leis/dispositivo/', '/api/leis/conferir', '/api/leis/fundamentos', '/api/leis/atalhos']) {
    assert.ok(js.includes(rota), rota);
  }
});

test('index.html carrega leis.js depois do app.js', () => {
  const iApp = html.indexOf('/app.js'), iLeis = html.indexOf('/leis.js');
  assert.ok(iApp > -1 && iLeis > iApp);
});

test('menu: Pesquisa de Leis para admin, equipe, advogado e estagiário, com rótulo, ícone e ajuda', () => {
  for (const papel of ['admin', 'staff', 'advogado', 'estagiario']) {
    const linha = app.match(new RegExp(`${papel}:\\s*\\[([^\\]]+)\\]`))[1];
    assert.ok(linha.includes("'leis'"), papel);
  }
  assert.match(app, /leis: 'Pesquisa de Leis'/);
  assert.match(app, /leis: 'book'/);
  assert.match(app, /book:\s+'<path/);
  assert.match(app, /leis: 'Pesquise em leis/);
});

test('o trecho da busca é escapado antes de virar <mark> (texto do acervo nunca vira HTML)', () => {
  const ctx = { esc: (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) };
  const marcar = new vm.Script(`(${js.match(/const marcar = (\(t\) => [^;]+);/)[1]})`).runInNewContext(ctx);
  assert.strictEqual(marcar('<img src=x onerror=1> [[justa]] causa'), '&lt;img src=x onerror=1&gt; <mark>justa</mark> causa');
});
