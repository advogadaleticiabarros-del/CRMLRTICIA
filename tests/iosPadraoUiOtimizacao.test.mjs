// Pedido explícito da Dra. Letícia (29/09/2026): "faça tudo que é padrão iOS,
// para otimizar o uso do meu CRM, não estou usando por estar difícil gerir".
// 2ª leva de padrões Apple aplicados via componentes COMPARTILHADOS (tabs,
// toolbar, título de página) — vale pra toda tela de uma vez, sem tocar
// tela por tela, e SEM mudar cor/fonte/raio do design system (só forma,
// posição e comportamento no celular).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.resolve('public/styles.css'), 'utf8');
const js = fs.readFileSync(path.resolve('public/app.js'), 'utf8');

test('abas viram "segmented control" (padrão iOS) só no celular, reaproveitando cores do sistema', () => {
  const i = css.indexOf('/* Abas em "segmented control"');
  const bloco = css.slice(i, css.indexOf('/* Campo de busca/filtro', i));
  assert.match(bloco, /\.tabs \{[^}]*border-radius: 11px/s);
  assert.match(bloco, /\.tab\.active \{[^}]*background: var\(--surface/s);
  // nenhuma cor nova inventada — reaproveita as variáveis já existentes
  assert.doesNotMatch(bloco, /#[0-9a-fA-F]{3,6}/);
});

test('campo de busca/filtro do toolbar ganha estilo de barra de busca do iOS no celular', () => {
  const i = css.indexOf('/* Campo de busca/filtro no estilo');
  const bloco = css.slice(i, css.indexOf('/* Modais viram', i));
  assert.match(bloco, /\.toolbar input\[type="text"\][^{]*\{[^}]*border-radius: 10px/s);
  assert.match(bloco, /background: var\(--bg\)/);
});

test('não inventou nenhuma variável de cor nova — só reaproveita tokens existentes do design system', () => {
  assert.doesNotMatch(css, /--bg-soft/);
});

test('título grande encolhe ao rolar (Large Title do iOS), respeitando reduzir-movimento', () => {
  assert.match(css, /body\.is-scrolled \.page-header h2 \{ font-size: 19px; \}/);
  assert.match(css, /body\.is-scrolled \.page-header \.sub \{ display: none; \}/);
  const i = css.indexOf('.modal-card { animation: none; }');
  assert.notEqual(i, -1);
  assert.match(css.slice(i, i + 200), /\.page-header h2 \{ transition: none; \}/);
});

test('listener de rolagem existe, é passivo e usa requestAnimationFrame (não trava rolagem no celular)', () => {
  const i = js.indexOf('function initLargeTitleCollapse');
  const bloco = js.slice(i, js.indexOf('\n}', i));
  assert.match(bloco, /\{ passive: true \}/);
  assert.match(bloco, /requestAnimationFrame/);
  assert.match(bloco, /is-scrolled/);
});

test('trocar de tela (hashchange) reseta o scroll e o título grande volta a aparecer', () => {
  const i = js.indexOf("window.addEventListener('hashchange'");
  const bloco = js.slice(i, js.indexOf('});', i));
  assert.match(bloco, /window\.scrollTo\(0, 0\)/);
  assert.match(bloco, /classList\.remove\('is-scrolled'\)/);
  assert.match(bloco, /router\(\)/);
});

test('tudo inicializado uma única vez, no mesmo lugar dos outros ajustes de mobile', () => {
  assert.match(js, /initModalDragToClose\(\); initLargeTitleCollapse\(\); quickSearchInited = true;/);
});
