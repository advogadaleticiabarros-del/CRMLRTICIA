// tests/painelIa.test.mjs — Métricas da IA: séries por dia e percentual sem custo
import { test } from 'node:test';
import assert from 'node:assert';
import { serieDiaria, resumoUsoIa, PROVEDORES_PAGOS } from '../dist/services/painelIaRegras.js';

test('serieDiaria: preenche com zero os dias sem uso, do mais antigo para hoje', () => {
  const s = serieDiaria([{ dia: '2026-10-13', chamadas: 4 }], 3, '2026-10-14');
  assert.deepStrictEqual(s, [
    { dia: '2026-10-12', chamadas: 0 },
    { dia: '2026-10-13', chamadas: 4 },
    { dia: '2026-10-14', chamadas: 0 },
  ]);
});

test('serieDiaria: aceita Date vinda do MySQL', () => {
  const s = serieDiaria([{ dia: new Date('2026-10-14T00:00:00Z'), chamadas: 2 }], 1, '2026-10-14');
  assert.deepStrictEqual(s, [{ dia: '2026-10-14', chamadas: 2 }]);
});

test('resumoUsoIa: soma por provedor e calcula o percentual sem custo', () => {
  const r = resumoUsoIa([
    { provedor: 'openai', chamadas: 80 }, { provedor: 'openai_smart', chamadas: 5 },
    { provedor: 'groq', chamadas: 10 }, { provedor: 'laya', chamadas: 5 },
  ]);
  assert.strictEqual(r.total, 100);
  assert.strictEqual(r.pagas, 85);
  assert.strictEqual(r.semCusto, 15);
  assert.strictEqual(r.percentualSemCusto, 15);
  assert.strictEqual(r.porProvedor.laya, 5);
  assert.ok(PROVEDORES_PAGOS.includes('openai'));
});

test('resumoUsoIa: sem uso → 0%, sem dividir por zero', () => {
  const r = resumoUsoIa([]);
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.percentualSemCusto, 0);
});
