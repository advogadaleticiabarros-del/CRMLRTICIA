// tests/propostaPaymentGateway.test.mjs
// Confirma que o campo novo de forma de pagamento via gateway é distinto do
// campo "Meios de pagamento aceitos" (data-meio) já existente, e que o
// checkbox de consentimento só é exigido quando a forma não é 'pix'.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('propostaForm tem o campo payment_gateway_method distinto de data-meio', () => {
  const src = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
  const m = src.match(/async function propostaForm[\s\S]*?\n\}/);
  assert.ok(m, 'propostaForm não encontrada');
  assert.match(m[0], /payment_gateway_method/, 'falta o campo novo de forma de pagamento via gateway');
  assert.match(m[0], /data-meio/, 'o campo antigo "meios de pagamento aceitos" não pode ser removido');
});

test('propostaForm exige consentimento explícito quando a forma não é pix', () => {
  const src = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
  const m = src.match(/async function propostaForm[\s\S]*?\n\}/);
  assert.match(m[0], /payment_consent/, 'falta o checkbox de consentimento');
});
