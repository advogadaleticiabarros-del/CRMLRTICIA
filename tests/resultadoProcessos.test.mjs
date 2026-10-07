// tests/resultadoProcessos.test.mjs — relatório "Resultado por processo": taxa de sucesso, % obtido e provisão
import { test } from 'node:test';
import assert from 'node:assert';
import { montarRelatorioResultados, ehSucesso } from '../dist/services/resultadoProcessos.js';

const base = { polo_cliente: 'ativo', dativo: false, fee_pct: 30, honorarios_recebidos: 0, honorarios_a_receber: 0, repasse_parceiro: 0 };

test('ehSucesso: acordo e procedência contam; improcedente e renúncia não', () => {
  assert.strictEqual(ehSucesso('acordo'), true);
  assert.strictEqual(ehSucesso('procedente_parcial'), true);
  assert.strictEqual(ehSucesso('improcedente'), false);
  assert.strictEqual(ehSucesso('renuncia'), false);
});

test('taxa de sucesso e % obtido sobre o valor da causa', () => {
  const r = montarRelatorioResultados([
    { ...base, id: 1, resultado: 'acordo', valor_causa: 10000, valor_obtido: 4000 },
    { ...base, id: 2, resultado: 'procedente', valor_causa: 20000, valor_obtido: 12000 },
    { ...base, id: 3, resultado: 'improcedente', valor_causa: 30000, valor_obtido: 0 },
    { ...base, id: 4, resultado: 'renuncia', valor_causa: null, valor_obtido: null },
  ]);
  assert.strictEqual(r.resumo.com_resultado, 4);
  assert.strictEqual(r.resumo.sucessos, 2);
  assert.strictEqual(r.resumo.taxa_sucesso, 50);
  // só casos de sucesso com causa e obtido: (4000+12000)/(10000+20000)
  assert.strictEqual(r.resumo.pct_obtido_medio, 53.3);
  assert.strictEqual(r.casos.find((c) => c.id === 1).pct_obtido, 40);
  assert.deepStrictEqual(r.resumo.por_resultado, { acordo: 1, procedente: 1, improcedente: 1, renuncia: 1 });
});

test('defesa (cliente ré) entra na taxa, mas não no % obtido', () => {
  const r = montarRelatorioResultados([
    { ...base, id: 1, resultado: 'acordo', valor_causa: 10000, valor_obtido: 5000 },
    { ...base, id: 2, resultado: 'acordo', polo_cliente: 'passivo', valor_causa: 36000, valor_obtido: null },
  ]);
  assert.strictEqual(r.resumo.taxa_sucesso, 100);
  assert.strictEqual(r.resumo.pct_obtido_medio, 50);
});

test('provisão: causa × taxa × % obtido × honorário do caso; dativo e defesa ficam fora', () => {
  const r = montarRelatorioResultados([
    { ...base, id: 1, resultado: 'acordo', valor_causa: 10000, valor_obtido: 5000 },
    { ...base, id: 2, resultado: 'improcedente', valor_causa: 10000, valor_obtido: 0 },
    // em andamento:
    { ...base, id: 3, resultado: null, valor_causa: 20000, valor_obtido: null },
    { ...base, id: 4, resultado: null, valor_causa: 20000, valor_obtido: null, fee_pct: 15 },
    { ...base, id: 5, resultado: null, valor_causa: 20000, valor_obtido: null, dativo: true },
    { ...base, id: 6, resultado: null, valor_causa: 20000, valor_obtido: null, polo_cliente: 'passivo' },
    { ...base, id: 7, resultado: null, valor_causa: null, valor_obtido: null },
  ]);
  // taxa 50%, % obtido 50% → caso 3: 20000×0,5×0,5×30% = 1500; caso 4: ×15% = 750
  assert.strictEqual(r.casos.find((c) => c.id === 3).provisao, 1500);
  assert.strictEqual(r.casos.find((c) => c.id === 4).provisao, 750);
  assert.strictEqual(r.casos.find((c) => c.id === 5).provisao, null);
  assert.strictEqual(r.casos.find((c) => c.id === 6).provisao, null);
  assert.strictEqual(r.casos.find((c) => c.id === 7).provisao, null);
  assert.strictEqual(r.resumo.provisao_total, 2250);
  assert.strictEqual(r.resumo.em_andamento, 5);
  assert.strictEqual(r.resumo.em_andamento_sem_valor, 1);
});

test('honorários: soma recebido, a receber e repasse ao parceiro', () => {
  const r = montarRelatorioResultados([
    { ...base, id: 1, resultado: 'acordo', valor_causa: 1, valor_obtido: 1, honorarios_recebidos: 1200.5, honorarios_a_receber: 300, repasse_parceiro: 150 },
    { ...base, id: 2, resultado: null, valor_causa: null, valor_obtido: null, honorarios_a_receber: 546.84 },
  ]);
  assert.strictEqual(r.resumo.honorarios_recebidos, 1200.5);
  assert.strictEqual(r.resumo.honorarios_a_receber, 846.84);
  assert.strictEqual(r.resumo.repasse_parceiro, 150);
});

test('sem nenhum resultado: taxa e provisão nulas, sem dividir por zero', () => {
  const r = montarRelatorioResultados([{ ...base, id: 1, resultado: null, valor_causa: 5000, valor_obtido: null }]);
  assert.strictEqual(r.resumo.taxa_sucesso, null);
  assert.strictEqual(r.resumo.provisao_total, 0);
  assert.strictEqual(r.casos[0].provisao, null);
});
