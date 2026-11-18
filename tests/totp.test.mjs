// Código do autenticador (TOTP, RFC 6238) gerado pelo CRM — 18/11/2026.
// Vetores oficiais do RFC 6238 (SHA-1), segredo "12345678901234567890".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codigoTotp, chaveTotpValida, normalizarChaveTotp } from '../dist/services/pjeJt/totp.js';

const CHAVE = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // base32 de "12345678901234567890"

test('gera o mesmo código do aplicativo autenticador (vetores do RFC 6238)', () => {
  assert.equal(codigoTotp(CHAVE, 59_000), '287082');
  assert.equal(codigoTotp(CHAVE, 1_111_111_109_000), '081804');
  assert.equal(codigoTotp(CHAVE, 1_234_567_890_000), '005924');
  assert.equal(codigoTotp(CHAVE, 2_000_000_000_000), '279037');
});

test('aceita a chave como o PJe mostra (minúsculas, espaços) e recusa chave inválida', () => {
  assert.equal(normalizarChaveTotp('gezd gnbv gy3t qojq gezd gnbv gy3t qojq'), CHAVE);
  assert.equal(codigoTotp('gezd gnbv gy3t qojq gezd gnbv gy3t qojq', 59_000), '287082');
  assert.equal(chaveTotpValida(CHAVE), true);
  assert.equal(chaveTotpValida('123456'), false, 'código de 6 dígitos não é a chave');
  assert.equal(chaveTotpValida('ABC!'), false);
  assert.equal(chaveTotpValida(''), false);
});
