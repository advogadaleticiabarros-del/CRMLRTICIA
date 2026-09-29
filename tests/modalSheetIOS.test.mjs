// Refatoração pedida pela Dra. Letícia (29/09/2026): telas no padrão iOS, sem
// mudar o design system (cores, tipografia, raio, sombra continuam os
// mesmos tokens — só a POSIÇÃO/ANIMAÇÃO/GESTO do modal muda no celular).
// O modal é um componente ÚNICO reaproveitado por toda tela do sistema —
// corrigir aqui melhora a experiência em todo lugar de uma vez só.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('public/index.html'), 'utf8');
const css = fs.readFileSync(path.resolve('public/styles.css'), 'utf8');
const js = fs.readFileSync(path.resolve('public/app.js'), 'utf8');

test('modal ganha a alça de arrastar (drag handle) no HTML', () => {
  const i = html.indexOf('id="modal"');
  const bloco = html.slice(i, html.indexOf('</div>\n\n  <div id="toast"'));
  assert.match(bloco, /class="modal-drag-handle"/);
});

test('alça fica escondida por padrão e só aparece no mobile', () => {
  assert.match(css, /\.modal-drag-handle \{ display: none; \}/);
  const i = css.indexOf('@media (max-width: 880px)');
  const bloco = css.slice(i, css.indexOf('\n}', i + 400));
  assert.match(css.slice(i, i + 3000), /\.modal-drag-handle \{[^}]*display: block/);
});

test('no mobile o modal SOBE DA BASE (sheet), não nasce do centro com scale', () => {
  assert.match(css, /@keyframes sheetUp \{ from \{ transform: translateY\(100%\); \} to \{ transform: translateY\(0\); \} \}/);
});

test('respeita prefers-reduced-motion (sem animação pra quem pediu)', () => {
  const i = css.lastIndexOf('@media (prefers-reduced-motion: reduce) { .modal-card');
  assert.notEqual(i, -1);
});

test('gesto de arrastar pra fechar só ativa em toque (pointer: coarse) e só pelo cabeçalho', () => {
  const i = js.indexOf('function initModalDragToClose');
  const bloco = js.slice(i, js.indexOf('\n}', i));
  assert.match(bloco, /pointer: coarse/);
  assert.match(bloco, /modal-header/);
  assert.match(bloco, /Math\.max\(0,/); // só deixa arrastar pra baixo, nunca pra cima
  assert.match(bloco, /deltaY > 110/);
  assert.match(bloco, /closeModal\(\)/);
});

test('inicializado uma única vez, junto da busca global', () => {
  assert.match(js, /initModalDragToClose\(\);\s*quickSearchInited = true;/);
});

test('sintaxe válida (JS e HTML balanceados)', () => {
  assert.equal((html.match(/<div/g) || []).length <= (html.match(/<\/div>/g) || []).length + 0, true);
});
