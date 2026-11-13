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

// ── Temas festivos e a CEO (13/11/2026) ───────────────────────────────────
function carregarTela() {
  const ctx = { ROUTES: {}, window: {}, document: {}, console };
  vm.createContext(ctx);
  new vm.Script(js).runInContext(ctx);
  return ctx.window.EscritorioTemas;
}

test('temas festivos: cada data cai no tema certo (Brasília)', () => {
  const T = carregarTela();
  const t = (iso) => T.temaDoDia(new Date(iso))?.id || null;
  assert.strictEqual(t('2026-11-13T15:00:00Z'), null);
  assert.strictEqual(t('2026-12-10T15:00:00Z'), 'natal');
  assert.strictEqual(t('2026-12-25T15:00:00Z'), 'natal');
  assert.strictEqual(t('2026-12-31T15:00:00Z'), 'reveillon');
  assert.strictEqual(t('2027-01-01T02:00:00Z'), 'reveillon'); // 31/12 às 23h em Brasília
  assert.strictEqual(t('2027-02-09T15:00:00Z'), 'carnaval'); // Páscoa 2027 = 28/03
  assert.strictEqual(t('2027-03-26T15:00:00Z'), 'pascoa');
  assert.strictEqual(t('2027-06-24T15:00:00Z'), 'junina');
  assert.strictEqual(t('2027-08-11T15:00:00Z'), 'advogado');
  assert.strictEqual(t('2027-09-07T15:00:00Z'), 'independencia');
});

test('temas festivos: todo tema tem nome, faixa e enfeites; Páscoa calculada certo', () => {
  const T = carregarTela();
  for (const tema of Object.values(T.TEMAS)) assert.ok(tema.nome && tema.faixa && tema.emoji, tema.id);
  assert.strictEqual(T.pascoa(2026).toISOString().slice(0, 10), '2026-04-05');
  assert.strictEqual(T.pascoa(2027).toISOString().slice(0, 10), '2027-03-28');
});

test('a CEO fica no gabinete e abre a Mesa da Chefe pela API própria', () => {
  assert.match(js, /\/api\/escritorio\/chefe/);
  assert.match(js, /abrirChefe/);
  assert.match(js, /ev-tema/);
});

test('mesas da sala não usam a classe .mesa (é da tela Mesa do caso e as escondia)', () => {
  assert.doesNotMatch(js, /class: 'mesa'/);
  assert.match(js, /class: 'ev-mesa'/);
});
