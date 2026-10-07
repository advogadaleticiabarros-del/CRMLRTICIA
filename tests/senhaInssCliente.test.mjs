// tests/senhaInssCliente.test.mjs — senha do Meu INSS do cliente: quem vê e como grava
import { test } from 'node:test';
import assert from 'node:assert';
import { podeVerSenhaInss, normalizarSenhaInss } from '../dist/services/senhaInssCliente.js';

test('só advogada, admin e equipe interna veem a senha', () => {
  for (const r of ['admin', 'advogado', 'staff']) assert.strictEqual(podeVerSenhaInss(r), true, r);
  for (const r of ['comercial', 'estagiario', 'parceiro', 'cliente', undefined]) assert.strictEqual(podeVerSenhaInss(r), false, String(r));
});

test('normalizarSenhaInss: corta espaços nas pontas; vazio limpa (null)', () => {
  assert.strictEqual(normalizarSenhaInss('  Abc123@ '), 'Abc123@');
  assert.strictEqual(normalizarSenhaInss(''), null);
  assert.strictEqual(normalizarSenhaInss(null), null);
});

test('normalizarSenhaInss: recusa texto longo demais (não é senha)', () => {
  assert.throws(() => normalizarSenhaInss('x'.repeat(101)), /longa/);
});
