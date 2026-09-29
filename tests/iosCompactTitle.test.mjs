// Continuação do Large Title (padrão iOS): o título encolhido MIGRA pra
// barra do topo em vez de só sumir — comportamento real do iOS, não uma
// aproximação. Módulo fechado (initCompactTitleSync): por fora só inicializa,
// por dentro decide tudo sozinho a cada troca de tela.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('public/index.html'), 'utf8');
const css = fs.readFileSync(path.resolve('public/styles.css'), 'utf8');
const js = fs.readFileSync(path.resolve('public/app.js'), 'utf8');

test('existe o elemento do título compacto na barra do topo', () => {
  assert.match(html, /<div class="topbar-compact-title" id="topbar-compact-title">/);
});

test('saudação e título compacto nunca aparecem juntos (display:none recíproco, não opacidade)', () => {
  const i = css.indexOf('.topbar-compact-title {');
  const bloco = css.slice(i, i + 700);
  assert.match(bloco, /body\.title-compact \.topbar-greeting \{ display: none; \}/);
  assert.match(bloco, /body\.title-compact \.topbar-compact-title \{ display: block; \}/);
});

test('observa o <h2> da tela atual com IntersectionObserver, não com scroll manual', () => {
  const i = js.indexOf('function initCompactTitleSync');
  const bloco = js.slice(i, js.indexOf('\nfunction initModalDragToClose', i));
  assert.match(bloco, /new IntersectionObserver/);
  assert.match(bloco, /entry\.isIntersecting/);
  assert.match(bloco, /rootMargin/);
});

test('acompanha a troca de tela via MutationObserver em #page (o <h2> muda de elemento a cada rota)', () => {
  const i = js.indexOf('function initCompactTitleSync');
  const bloco = js.slice(i, js.indexOf('\nfunction initModalDragToClose', i));
  assert.match(bloco, /new MutationObserver/);
  assert.match(bloco, /childList: true, subtree: true/);
  assert.match(bloco, /page-header h2/);
});

test('desconecta o observador antigo antes de trocar de título (não deixa listener acumulando)', () => {
  const i = js.indexOf('function initCompactTitleSync');
  const bloco = js.slice(i, js.indexOf('\nfunction initModalDragToClose', i));
  assert.match(bloco, /tituloObserver\.disconnect\(\)/);
});

test('tela sem <h2> de página não quebra nada (observarTitulo tolera h2 nulo)', () => {
  const i = js.indexOf('const observarTitulo = ');
  const bloco = js.slice(i, js.indexOf('};', i));
  assert.match(bloco, /if \(!h2\) return;/);
});

test('inicializado junto dos outros ajustes de mobile, uma única vez', () => {
  assert.match(js, /initModalDragToClose\(\);.*initCompactTitleSync\(\);.*quickSearchInited = true;/);
});
