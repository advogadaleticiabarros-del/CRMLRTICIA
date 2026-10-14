// tests/prestacaoContasFrontend.test.mjs — "Recebi e repassei" abre a prestação de contas
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const app = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
const ini = app.indexOf('async function acordoRepassesModal');
const bloco = app.slice(ini, app.indexOf('// Envia a minuta própria', ini));

test('marcar o repasse abre a prestação de contas da parcela', () => {
  assert.match(bloco, /Recebi e repassei/);
  assert.match(bloco, /marcar-repassado[\s\S]*prestacaoContasModal\(b\.dataset\.payoutMark/);
});

test('parcelas já repassadas têm o botão "Prestação de contas"', () => {
  assert.match(bloco, /data-prestacao="\$\{r\.id\}">Prestação de contas/);
});

test('a janela tem o texto para copiar e um único botão de envio pelo WhatsApp', () => {
  assert.match(bloco, /id="pc-copiar"/);
  assert.match(bloco, /id="pc-enviar"/);
  assert.match(bloco, /\/prestacao\/enviar/);
  assert.strictEqual((bloco.match(/id="pc-enviar"/g) || []).length, 1);
});
