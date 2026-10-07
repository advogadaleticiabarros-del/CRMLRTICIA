// tests/taxaCalculos.test.mjs — percentual de cálculos (contabilidade), 1 a 5% dos proventos
import { test } from 'node:test';
import assert from 'node:assert';
import { taxaCalculosPct, clausulaTaxaCalculos, montarClausulaValores, buildTemplateFamiliaPensao } from '../dist/services/contractTemplates.js';

test('taxaCalculosPct: só aceita 1 a 5 (inteiro); fora disso é 0 (não cobra)', () => {
  assert.strictEqual(taxaCalculosPct({ taxa_calculos_pct: 3 }), 3);
  assert.strictEqual(taxaCalculosPct({ taxa_calculos_pct: '5' }), 5);
  for (const v of [0, 6, -1, 2.5, 'x', null, undefined]) assert.strictEqual(taxaCalculosPct({ taxa_calculos_pct: v }), 0, String(v));
  assert.strictEqual(taxaCalculosPct(null), 0);
});

test('clausulaTaxaCalculos: texto com percentual por extenso; vazio quando não cobra', () => {
  assert.match(clausulaTaxaCalculos({ taxa_calculos_pct: 2 }), /2% \(dois por cento\) sobre o valor dos proventos/);
  assert.match(clausulaTaxaCalculos({ taxa_calculos_pct: 2 }), /contabilidade/);
  assert.strictEqual(clausulaTaxaCalculos({}), '');
});

test('contrato geral: cláusula de valores inclui a taxa de cálculos', () => {
  const { texto } = montarClausulaValores({ honorarios: { modalidades: ['exito'], values: { exito: 30 }, taxa_calculos_pct: 4 } });
  assert.match(texto, /30% \(trinta por cento\)/);
  assert.match(texto, /4% \(quatro por cento\) sobre o valor dos proventos/);
  const sem = montarClausulaValores({ honorarios: { modalidades: ['exito'], values: { exito: 30 } } }).texto;
  assert.doesNotMatch(sem, /proventos/);
});

test('contrato de pensão: a taxa de cálculos também aparece', () => {
  const c = buildTemplateFamiliaPensao({ clientName: 'Fulana', honorarios: { parcelamento: { total: 1000, entrada: 200, parcelas: 4, valor_parcela: 200 }, taxa_calculos_pct: 1 } });
  assert.match(c, /1% \(um por cento\) sobre o valor dos proventos/);
});
