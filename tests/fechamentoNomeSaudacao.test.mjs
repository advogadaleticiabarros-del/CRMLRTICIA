// Bug real (08/10/2026): o fechamento do dia chegou como "Fechamento do dia,
// Dra. Administrador" — usava o nome do primeiro usuário (o técnico).
import { test } from 'node:test';
import assert from 'node:assert';
import { nomeSaudacao } from '../dist/services/eveningClosingService.js';

const USERS = [{ name: 'Administrador', role: 'admin' }, { name: 'Letícia Elias Barros', role: 'advogado' }];

test('saudação usa a advogada mesmo quando o laço começa pelo admin', () => {
  assert.strictEqual(nomeSaudacao(USERS, USERS[0]), 'Letícia');
  assert.strictEqual(nomeSaudacao(USERS, USERS[1]), 'Letícia');
});

test('nunca "Administrador", mesmo sem advogado cadastrado', () => {
  assert.strictEqual(nomeSaudacao([USERS[0]], USERS[0]), 'Letícia');
});
