// Pedido da Dra. Letícia (29/09/2026, "SIM" ao seguir com ações de lista).
// Investigação mostrou que "arrastar pra revelar" brigaria com o cartão
// mobile já existente (a coluna de ações já vira botões largos e sempre
// visíveis no rodapé do cartão, ver td[data-label=""]). O padrão iOS certo
// pra esse caso é condensar 3+ ações num botão "Ações ⋯" que abre uma folha
// — reaproveita o modal/sheet já construído, automático via o mesmo hook
// que já transforma toda tabela em cartão no celular (zero mudança por tela).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const js = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
const css = fs.readFileSync(path.resolve('public/styles.css'), 'utf8');

test('condensarAcoesDaLinha só age no celular e só com 3+ botões', () => {
  const i = js.indexOf('function condensarAcoesDaLinha');
  const bloco = js.slice(i, js.indexOf('\nfunction enhanceTables', i));
  assert.match(bloco, /max-width: 880px/);
  assert.match(bloco, /botoes\.length < 3\) return;/);
});

test('move os botões originais (não clona) — preserva o onclick já ligado por cada tela', () => {
  const i = js.indexOf('function condensarAcoesDaLinha');
  const bloco = js.slice(i, js.indexOf('\nfunction enhanceTables', i));
  assert.match(bloco, /guardaChuva\.appendChild\(b\)\); \/\/ move/);
  assert.doesNotMatch(bloco, /\.cloneNode/);
});

test('botão "Ações ⋯" abre a folha (reaproveita openModal, não um componente novo)', () => {
  const i = js.indexOf('function condensarAcoesDaLinha');
  const bloco = js.slice(i, js.indexOf('\nfunction enhanceTables', i));
  assert.match(bloco, /openModal\('Ações', wrap\)/);
  assert.match(bloco, /closeModal\(\); b\.click\(\);/);
});

test('é acionado automaticamente pelo mesmo hook que já roda em toda tabela (sem mudar tela por tela)', () => {
  const i = js.indexOf('function labelTableCells');
  const bloco = js.slice(i, js.indexOf('\n}', i));
  assert.match(bloco, /condensarAcoesDaLinha\(tr\);/);
});

test('idempotente — não condensa a mesma linha duas vezes (ex.: re-render parcial)', () => {
  const i = js.indexOf('function condensarAcoesDaLinha');
  const bloco = js.slice(i, js.indexOf('\nfunction enhanceTables', i));
  assert.match(bloco, /if \(tr\.dataset\.acoesCondensadas\) return;/);
  assert.match(bloco, /tr\.dataset\.acoesCondensadas = '1';/);
});

test('CSS: botão condensado fica logo antes do fim do bloco mobile (mesmo bloco do cartão)', () => {
  const i = css.indexOf('.row-actions-mais');
  assert.notEqual(i, -1);
  const bloco = css.slice(i, i + 400);
  assert.match(bloco, /\.page tbody td \{ word-break: break-word; \}/);
});

test('CSS: itens da folha de ações usam tokens do design system já existentes', () => {
  const i = css.indexOf('.row-actions-sheet-item {');
  const bloco = css.slice(i, i + 300);
  assert.match(bloco, /var\(--border-soft\)/);
  assert.match(bloco, /var\(--text\)/);
});
