// tests/excluirProposta.test.mjs — quando uma proposta pode ser excluída
import { test } from 'node:test';
import assert from 'node:assert';
import { motivoBloqueioExclusao } from '../dist/services/excluirProposta.js';

test('proposta em rascunho, enviada, em negociação ou recusada pode ser excluída', () => {
  for (const status of ['rascunho', 'enviada', 'em_negociacao', 'recusada', 'expirada'])
    assert.strictEqual(motivoBloqueioExclusao({ status, aceito_em: null }, 0), null, status);
});

test('proposta aceita não pode (já gerou contrato/parcelas)', () => {
  assert.match(motivoBloqueioExclusao({ status: 'aceita', aceito_em: null }, 0), /aceita/);
  assert.match(motivoBloqueioExclusao({ status: 'enviada', aceito_em: '2026-10-01' }, 0), /aceita/);
});

test('proposta com parcelas geradas não pode', () => {
  assert.match(motivoBloqueioExclusao({ status: 'enviada', aceito_em: null }, 2), /parcelas/);
});

test('proposta inexistente', () => {
  assert.match(motivoBloqueioExclusao(null, 0), /não encontrada/);
});
