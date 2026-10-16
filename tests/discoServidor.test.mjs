// tests/discoServidor.test.mjs — alarme de disco da VPS (Dr. Bento)
import { test } from 'node:test';
import assert from 'node:assert';
import { avisoDisco, usoDoDisco, LIMITE_ATENCAO, LIMITE_URGENTE } from '../dist/services/discoServidor.js';

test('avisoDisco: abaixo de 85% não avisa', () => {
  assert.strictEqual(avisoDisco({ usadoPct: 27, livresGb: 71, totalGb: 96 }), null);
  assert.strictEqual(avisoDisco({ usadoPct: LIMITE_ATENCAO - 1, livresGb: 15, totalGb: 96 }), null);
});

test('avisoDisco: 85% avisa com atenção, 92% é urgente', () => {
  const a = avisoDisco({ usadoPct: 86, livresGb: 13.4, totalGb: 96 });
  assert.match(a.titulo, /86%/);
  assert.match(a.texto, /13\.4 GB livres de 96 GB/);
  assert.match(a.texto, /docker builder prune/);
  assert.doesNotMatch(a.texto, /Precisa liberar hoje/);
  const u = avisoDisco({ usadoPct: LIMITE_URGENTE, livresGb: 7, totalGb: 96 });
  assert.match(u.titulo, /🚨/);
  assert.match(u.texto, /Precisa liberar hoje/);
});

test('usoDoDisco: lê o disco de verdade e devolve números coerentes', () => {
  const u = usoDoDisco(process.cwd());
  assert.ok(u.usadoPct >= 0 && u.usadoPct <= 100);
  assert.ok(u.totalGb > 0 && u.livresGb >= 0 && u.livresGb <= u.totalGb);
});
