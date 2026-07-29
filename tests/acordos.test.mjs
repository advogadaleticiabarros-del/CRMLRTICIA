// tests/acordos.test.mjs — acordo extrajudicial: repasse ao cliente e texto do cronograma
import { test } from 'node:test';
import assert from 'node:assert';
import { montarRepassesCliente, cronogramaAcordoTexto } from '../dist/services/agreementFinance.js';

test('montarRepassesCliente: honorário retido proporcional a cada tranche, resto líquido', () => {
  const acordo = {
    total_agreement_value: 10000, entrada_value: 2000, entrada_date: '2026-01-01',
    installments_count: 2, first_due_date: '2026-02-01', honorarium_value: 2000,
  };
  const payouts = montarRepassesCliente(acordo);
  assert.strictEqual(payouts.length, 3);
  assert.deepStrictEqual(payouts[0], { tranche_label: 'Entrada', valor_bruto: 2000, valor_honorarios: 400, valor_liquido: 1600, data_prevista: '2026-01-01' });
  assert.deepStrictEqual(payouts[1], { tranche_label: '1ª parcela', valor_bruto: 4000, valor_honorarios: 800, valor_liquido: 3200, data_prevista: '2026-02-01' });
  assert.deepStrictEqual(payouts[2], { tranche_label: '2ª parcela', valor_bruto: 4000, valor_honorarios: 800, valor_liquido: 3200, data_prevista: '2026-03-01' });
});

test('montarRepassesCliente: sem honorários, repasse é o valor integral', () => {
  const acordo = { total_agreement_value: 5000, entrada_value: 0, entrada_date: null, installments_count: 1, first_due_date: '2026-01-01', honorarium_value: 0 };
  const payouts = montarRepassesCliente(acordo);
  assert.strictEqual(payouts.length, 1);
  assert.deepStrictEqual(payouts[0], { tranche_label: '1ª parcela', valor_bruto: 5000, valor_honorarios: 0, valor_liquido: 5000, data_prevista: '2026-01-01' });
});

test('montarRepassesCliente: sem cronograma definido, lista vazia', () => {
  const acordo = { total_agreement_value: 0, entrada_value: 0, entrada_date: null, installments_count: 0, first_due_date: null, honorarium_value: 0 };
  assert.deepStrictEqual(montarRepassesCliente(acordo), []);
});

test('cronogramaAcordoTexto: entrada + 2 parcelas formatadas em pt-BR', () => {
  const tranches = [
    { label: 'Entrada', valor: 2000, data: '2026-01-01' },
    { label: '1ª parcela', valor: 4000, data: '2026-02-01' },
    { label: '2ª parcela', valor: 4000, data: '2026-03-01' },
  ];
  const texto = cronogramaAcordoTexto(tranches);
  assert.strictEqual(
    texto,
    'Entrada de R$ 2.000,00 em 01/01/2026; 1ª parcela de R$ 4.000,00 em 01/02/2026; 2ª parcela de R$ 4.000,00 em 01/03/2026.'
  );
});

test('cronogramaAcordoTexto: sem tranches, texto de pagamento à vista', () => {
  assert.strictEqual(cronogramaAcordoTexto([]), 'pagamento à vista, conforme acordado entre as partes');
});
