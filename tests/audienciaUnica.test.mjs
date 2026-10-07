// tests/audienciaUnica.test.mjs — a mesma audiência copiada na agenda de 2 usuários é UMA audiência
import { test } from 'node:test';
import assert from 'node:assert';
import { chaveAudiencia, agruparAudiencias } from '../dist/services/audienciaUnica.js';

// caso real (07/10/2026): audiência da Larissa importada do Google para o usuário 1 e o usuário 2
const larissa1 = { id: 694, client_id: 108, case_id: 56, start_datetime: new Date('2026-10-08T16:00:00Z') };
const larissa2 = { id: 772, client_id: 108, case_id: 56, start_datetime: new Date('2026-10-08T16:00:00Z') };

test('chaveAudiencia: mesmo cliente e mesmo horário → mesma chave', () => {
  assert.strictEqual(chaveAudiencia(larissa1), chaveAudiencia(larissa2));
  assert.strictEqual(chaveAudiencia(larissa1), 'cl108_2026-10-08T16:00');
});

test('chaveAudiencia: sem cliente usa o caso; sem nenhum, o próprio evento', () => {
  assert.strictEqual(chaveAudiencia({ id: 5, client_id: null, case_id: 9, start_datetime: '2026-10-08 16:30:00' }), 'ca9_2026-10-08T16:30');
  assert.strictEqual(chaveAudiencia({ id: 5, client_id: null, case_id: null, start_datetime: '2026-10-08T16:30:00Z' }), 'ev5_2026-10-08T16:30');
});

test('agruparAudiencias: duas cópias viram uma, com os ids das duas', () => {
  const outra = { id: 800, client_id: 108, case_id: 56, start_datetime: new Date('2026-10-20T13:00:00Z') };
  const g = agruparAudiencias([larissa1, larissa2, outra]);
  assert.strictEqual(g.length, 2);
  assert.strictEqual(g[0].evento.id, 694);
  assert.deepStrictEqual(g[0].ids, [694, 772]);
  assert.deepStrictEqual(g[1].ids, [800]);
});
