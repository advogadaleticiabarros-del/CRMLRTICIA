// Design system 3.0 (17/11/2026) — trava as regras visuais do DESIGN.md para que
// nenhuma mudança futura traga de volta o que a auditoria de 17/11 removeu:
// letra < 12px, transition: all, maiúsculas espaçadas, fontes extras, confirm()
// do navegador, emoji como ícone e cartões presos a 85% da largura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('public/styles.css', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
// escritorio.js fica de fora da regra de emoji até a revisão do Escritório virtual.
const JS = ['public/app.js', 'public/whatsapp.js', 'public/visaoCliente.js', 'public/mesa.js', 'public/tarefas.js', 'public/loteCliente.js', 'public/portal-parceiro.js', 'public/leis.js'];
const semComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('CSS: nenhuma letra abaixo de 12px', () => {
  const pequenas = semComentarios(css).match(/font-size:\s*(?:[0-9]|1[01])(?:\.\d+)?px/g) || [];
  assert.deepEqual(pequenas, [], `achei ${pequenas.length}: ${pequenas.slice(0, 5).join(', ')}`);
});

test('CSS: nada de transition: all (anima até o que não deve)', () => {
  assert.doesNotMatch(semComentarios(css), /transition:\s*all\b/);
});

test('CSS: sem maiúsculas forçadas nos rótulos', () => {
  assert.doesNotMatch(semComentarios(css), /text-transform:\s*uppercase/);
});

test('CSS: cartões ocupam a largura toda (sem a regra antiga de 85%/90% centralizado)', () => {
  assert.doesNotMatch(css, /\.card \{ width: (85|90)% !important/);
});

test('CSS: a camada do design system 3.0 existe e fica no fim do arquivo', () => {
  const i = css.indexOf('DESIGN SYSTEM 3.0 (17/11/2026)');
  assert.ok(i > 0, 'camada não encontrada');
  assert.ok(i > css.length * 0.8, 'a camada precisa ficar no fim para vencer as antigas');
  assert.match(css, /--on-gold:\s*#1f3047/);
  assert.match(css, /--text-muted:\s*#6b6352/);
});

test('fontes: só Inter (interface) e Spectral (marca) na tela principal', () => {
  const link = html.match(/fonts\.googleapis\.com\/css2\?[^"]+/)[0];
  assert.match(link, /family=Inter/);
  assert.match(link, /family=Spectral/);
  assert.doesNotMatch(link, /Garamond|Playfair|Cormorant/);
});

test('JS: nenhuma confirmação pelo confirm() do navegador — usar confirmar()', () => {
  for (const arq of JS) {
    const fonte = semComentarios(fs.readFileSync(arq, 'utf8'));
    assert.doesNotMatch(fonte, /(^|[^.\w])confirm\(/, `${arq} ainda usa confirm()`);
  }
});

test('JS: emoji não é ícone de interface (reações do WhatsApp e marcas internas de mensagem são exceção)', () => {
  const PERMITIDOS = new Set(['👍', '❤', '😂', '😮', '😢', '🙏', '📝', '🚫', '↗', '↩', '✔', '✓', '☑', '□', '↔']);
  for (const arq of JS) {
    const fonte = semComentarios(fs.readFileSync(arq, 'utf8'));
    const achados = [...new Set(fonte.match(/\p{Extended_Pictographic}/gu) || [])].filter((e) => !PERMITIDOS.has(e));
    assert.deepEqual(achados, [], `${arq}: ${achados.join(' ')}`);
  }
});
