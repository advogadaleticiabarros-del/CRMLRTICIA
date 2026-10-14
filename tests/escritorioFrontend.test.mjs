// tests/escritorioFrontend.test.mjs — tela do Escritório virtual ligada ao CRM
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const js = fs.readFileSync(path.resolve('public/escritorio.js'), 'utf8');
const app = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
const html = fs.readFileSync(path.resolve('public/index.html'), 'utf8');

test('escritorio.js é JavaScript válido', () => {
  assert.doesNotThrow(() => new vm.Script(js));
});

test('registra a rota escritorio e o painel de métricas usa a API certa', () => {
  assert.match(js, /Object\.assign\(ROUTES,\s*\{[\s\S]*async escritorio\(page\)/);
  assert.match(js, /\/api\/escritorio\/painel-ia\?dias=/);
  assert.match(js, /\/api\/escritorio\/agente\//);
});

test('index.html carrega escritorio.js depois do app.js', () => {
  const iApp = html.indexOf('/app.js'), iEsc = html.indexOf('/escritorio.js');
  assert.ok(iApp > -1 && iEsc > iApp);
});

test('menu: escritório para admin, equipe e advogado, com rótulo, ícone e ajuda', () => {
  for (const papel of ['admin', 'staff', 'advogado']) {
    const linha = app.match(new RegExp(`${papel}:\\s*\\[([^\\]]+)\\]`))[1];
    assert.ok(linha.includes("'escritorio'"), papel);
  }
  assert.match(app, /escritorio: 'Escritório virtual'/);
  assert.match(app, /escritorio: 'users'/);
  assert.match(app, /escritorio: 'A equipe de agentes/);
});

test('a sala reposiciona os nós em vez de recriar (animações não reiniciam a cada quadro)', () => {
  assert.match(js, /assinaturaMesa/);
  assert.match(js, /setAttribute\('transform'/);
});
