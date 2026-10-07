// Pedido (07/10/2026), ao trazer o novo contrato trabalhista: "não deixando
// quebra de página distante o suficiente para que o rodapé não tampe nada e
// com locais corretos para assinatura". Renderizando o contrato no Chrome:
// 1) o rodapé fixo (bottom 0.7cm, left 3cm/right 2cm DENTRO da área da página)
//    ficava estreito, quebrava em 2 linhas e encostava na última linha do texto,
//    porque o espaço reservado (tfoot 1.15cm) era menor que o rodapé;
// 2) "break-inside: avoid" NÃO é respeitado dentro da célula da tabela do papel
//    timbrado — a assinatura da contratada saía partida (nome numa página,
//    "CONTRATADA / OAB" na outra). Bloco inline-block é indivisível de verdade.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
const ini = src.indexOf('function printDocs(');
const css = src.slice(ini, src.indexOf('</style>', ini));
const regra = (sel) => (css.match(new RegExp(`${sel.replace(/\./g, '\\.')} \\{([^}]*)\\}`)) || [])[1] || '';
const cm = (decl, prop) => Number((decl.match(new RegExp(`${prop}:\\s*([\\d.]+)cm`)) || [])[1]);

// formatDocHtml roda em Node (só manipula string)
const f0 = src.indexOf('function formatDocHtml(');
const formatDocHtml = new Function(`${src.slice(f0, src.indexOf('\nfunction ', f0 + 10))}; return formatDocHtml;`)();

test('rodapé ocupa a largura da área da página, em uma linha só, colado embaixo', () => {
  const f = regra('.lh-footer-fixed');
  assert.match(f, /bottom: 0;/);
  assert.match(f, /left: 0;/);
  assert.match(f, /right: 0;/);
  assert.match(f, /white-space: nowrap;/);
});

test('espaço reservado no fim de cada página é maior que o rodapé + folga (≥ 1.4cm)', () => {
  assert.ok(cm(regra('.lh-foot-spacer'), 'height') >= 1.4, regra('.lh-foot-spacer'));
});

test('título de cláusula não fica sozinho no pé da página', () => {
  assert.match(css, /\.content \.clause, \.content \.section-heading \{[^}]*break-after: avoid/);
});

test('bloco de assinatura e grupo de assinaturas são indivisíveis (inline-block)', () => {
  assert.match(css, /\.content \.sig-block, \.content \.sig-group \{[^}]*display: inline-block;[^}]*width: 100%/);
});

const contrato = `CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS

Cláusulas...

E, por estarem justas e contratadas, as partes assinam o presente instrumento.

Vitória/ES, [DATA].

_______________________________________
MAILZA DOS SANTOS COSTA
CONTRATANTE
CPF nº 627.009.015-68

_______________________________________
LETÍCIA ELIAS BARROS
CONTRATADA
OAB/ES 39.948`;

test('até 2 assinaturas: local/data e as duas assinaturas vão juntos num só grupo', () => {
  const h = formatDocHtml(contrato);
  const g = h.slice(h.indexOf('<div class="sig-group">'));
  assert.ok(h.includes('<div class="sig-group">'), h);
  assert.match(g, /^<div class="sig-group"><p class="body">E, por estarem justas e contratadas[^<]*<\/p><div class="sp"><\/div><p class="body">Vitória\/ES, \[DATA\]\.<\/p>/);
  assert.ok(h.includes('<p class="body">Cláusulas...</p>'), 'texto anterior fica fora do grupo');
  assert.ok(g.indexOf('MAILZA') > 0 && g.indexOf('LETÍCIA') > g.indexOf('MAILZA'));
  assert.ok(h.trimEnd().endsWith('</div></div>'));
});

test('3+ assinaturas: sem grupo (não caberia numa página); cada assinatura segue indivisível', () => {
  const tres = contrato + '\n\n_______________________________________\nTESTEMUNHA\nCPF';
  const h = formatDocHtml(tres);
  assert.ok(!h.includes('sig-group'));
  assert.strictEqual((h.match(/class="sig-block"/g) || []).length, 3);
});

test('assinatura eletrônica continua entrando no lugar da linha', () => {
  const h = formatDocHtml(contrato, { 'MAILZA DOS SANTOS COSTA': { image: 'data:x', signedAt: '2026-10-07T12:00:00Z', code: 'ABC' } });
  assert.match(h, /<img class="sig-photo" src="data:x"/);
});

test('PDF de tabela (printTablePDF) usa o mesmo rodapé corrigido', () => {
  const i = src.indexOf('function printTablePDF(');
  const css2 = src.slice(i, src.indexOf('</style>', i));
  assert.match(css2, /\.lh-footer-fixed \{ position: fixed; bottom: 0; left: 0; right: 0; white-space: nowrap;/);
  assert.match(css2, /\.lh-foot-spacer \{ height: 1\.4cm; \}/);
});
