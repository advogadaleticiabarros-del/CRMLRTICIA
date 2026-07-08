// tests/regras-financeiras.test.mjs — regras de dinheiro do escritório
// (entrada da parceria 100/130, parse de valores pt-BR, telefone p/ WhatsApp)
import { test } from 'node:test';
import assert from 'node:assert';
import { entradaDevida } from '../dist/services/partnerEntry.js';
import { parseValorBR } from '../dist/utils/money.js';
import { normalizePhone } from '../dist/services/whatsappQueue.js';

// ── Entrada da parceria: 1 caso = 100 · 2+ casos = 130 (total por cliente) ──
test('entrada: 0 casos protocolados não deve nada', () => {
  assert.strictEqual(entradaDevida(0), 0);
});
test('entrada: 1 caso = R$ 100', () => {
  assert.strictEqual(entradaDevida(1), 100);
});
test('entrada: 2 casos = R$ 130 (total, não 200)', () => {
  assert.strictEqual(entradaDevida(2), 130);
});
test('entrada: 5 casos continua R$ 130', () => {
  assert.strictEqual(entradaDevida(5), 130);
});
test('entrada: respeita valores do contrato do parceiro', () => {
  assert.strictEqual(entradaDevida(1, 150, 200), 150);
  assert.strictEqual(entradaDevida(3, 150, 200), 200);
});

// ── Valor da causa: aceita pt-BR e formato simples ──────────────────────────
test('valor: "1.500,50" (pt-BR) vira 1500.50', () => {
  assert.strictEqual(parseValorBR('1.500,50'), 1500.5);
});
test('valor: "1500.50" vira 1500.50', () => {
  assert.strictEqual(parseValorBR('1500.50'), 1500.5);
});
test('valor: "R$ 25.000,00" vira 25000', () => {
  assert.strictEqual(parseValorBR('R$ 25.000,00'), 25000);
});
test('valor: inteiro simples "1500" vira 1500', () => {
  assert.strictEqual(parseValorBR('1500'), 1500);
});
test('valor: vazio, lixo e negativo viram null', () => {
  assert.strictEqual(parseValorBR(''), null);
  assert.strictEqual(parseValorBR('abc'), null);
  assert.strictEqual(parseValorBR('-10'), null);
  assert.strictEqual(parseValorBR(null), null);
});

// ── Telefone para wa.me: sempre dígitos com DDI 55 ──────────────────────────
test('telefone: "(27) 99999-8888" vira 5527999998888', () => {
  assert.strictEqual(normalizePhone('(27) 99999-8888'), '5527999998888');
});
test('telefone: fixo com DDD "27 3333-4444" vira 552733334444', () => {
  assert.strictEqual(normalizePhone('27 3333-4444'), '552733334444');
});
test('telefone: já com 55 não duplica', () => {
  assert.strictEqual(normalizePhone('5527999998888'), '5527999998888');
});
test('telefone: vazio ou curto demais vira null', () => {
  assert.strictEqual(normalizePhone(''), null);
  assert.strictEqual(normalizePhone('9999'), null);
  assert.strictEqual(normalizePhone(null), null);
});
