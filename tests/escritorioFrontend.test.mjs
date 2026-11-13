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

// ── Salas separadas com corredores (13/11/2026) ──────────────────────────
import { AGENTES as LISTA_AGENTES, SETORES as LISTA_SETORES } from '../dist/services/escritorioVirtual.js';

function planta() {
  const ctx = { ROUTES: {}, window: {}, document: {}, console };
  vm.createContext(ctx);
  new vm.Script(js).runInContext(ctx);
  const P = ctx.window.EscritorioPlanta;
  const pl = P.planejarSala(LISTA_AGENTES.map((a) => ({ id: a.id, setor: a.setor })), LISTA_SETORES);
  P.usarPlano(pl);
  return { P, pl };
}

test('salas: um setor por sala, sem sobreposição, com corredor entre elas e toda mesa dentro da sua sala', () => {
  const { pl } = planta();
  const ids = new Set(pl.salas.map((s) => s.id));
  for (const s of LISTA_SETORES) assert.ok(ids.has(s.id), s.id);
  for (const a of pl.salas) for (const b of pl.salas) {
    if (a === b) continue;
    const sobrepoe = a.x0 < b.x1 - 1e-9 && b.x0 < a.x1 - 1e-9 && a.y0 < b.y1 - 1e-9 && b.y0 < a.y1 - 1e-9;
    assert.ok(!sobrepoe, `${a.id} x ${b.id}`);
    // mesma coluna e uma embaixo da outra → corredor entre elas
    if (a.x0 === b.x0 && a.y1 <= b.y0) assert.ok(b.y0 - a.y1 >= 0.85, `corredor ${a.id}→${b.id}`);
  }
  for (const [id, m] of Object.entries(pl.mesas)) {
    if (!m.sala) continue;
    const s = m.sala;
    assert.ok(m.bx >= s.x0 && m.bx + 1.2 <= s.x1 && m.by - 0.4 >= s.y0 && m.by + 0.7 <= s.y1, id);
  }
});

test('salas: o caminho de cada agente até o corredor e de volta só atravessa parede pelo vão da porta', () => {
  const { P, pl } = planta();
  const VAO = 0.42;
  const paredes = pl.salas.flatMap((s) => [
    { eixo: 'y', v: s.y0, de: s.x0, ate: s.x1, porta: null },
    { eixo: 'x', v: s.x0, de: s.y0, ate: s.y1, porta: null },
    { eixo: 'y', v: s.y1, de: s.x0, ate: s.x1, porta: s.porta === 'frente' ? s.faixaX : null },
    { eixo: 'x', v: s.x1, de: s.y0, ate: s.y1, porta: s.porta === 'direita' ? s.portaY : null },
  ]);
  const cruza = (a, b) => {
    for (const w of paredes) {
      const [c0, c1, o0, o1] = w.eixo === 'y' ? [a.y, b.y, a.x, b.x] : [a.x, b.x, a.y, b.y];
      if ((c0 - w.v) * (c1 - w.v) >= 0) continue; // não passa de um lado ao outro
      const t = (w.v - c0) / (c1 - c0), o = o0 + t * (o1 - o0);
      if (o <= w.de || o >= w.ate) continue;
      if (w.porta !== null && Math.abs(o - w.porta) < VAO) continue;
      return w;
    }
    return null;
  };
  for (const [id, m] of Object.entries(pl.mesas)) {
    if (!m.sala) continue;
    for (const [de, para, mDe, mPara] of [[m.assento, { x: P.ESPINHA_X, y: 6 }, m, null], [{ x: 12.6, y: 8.9 }, m.assento, null, m]]) {
      const caminho = [de, ...P.rota(de, para, mDe, mPara)];
      for (let i = 1; i < caminho.length; i++) {
        const w = cruza(caminho[i - 1], caminho[i]);
        assert.ok(!w, `${id} atravessa a parede ${w && w.eixo}=${w && w.v}`);
      }
    }
  }
});
