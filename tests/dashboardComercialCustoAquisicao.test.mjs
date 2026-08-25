// tests/dashboardComercialCustoAquisicao.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/routes/dashboards/comercial.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { calcularCustoAquisicao } = await import('../dist/routes/dashboards/comercial.js');

test('calcula custo por cliente corretamente quando há gasto e clientes', () => {
  const gastos = [{ canal: 'Meta Ads', valor: 900 }];
  const clientesPorCanal = [{ canal: 'Meta Ads', total: 3 }];
  const r = calcularCustoAquisicao(gastos, clientesPorCanal);
  assert.equal(r.length, 1);
  assert.equal(r[0].canal, 'Meta Ads');
  assert.equal(r[0].gasto, 900);
  assert.equal(r[0].clientes, 3);
  assert.equal(r[0].custo_por_cliente, 300, '900/3 = 300');
});

test('canal orgânico sem gasto aparece com gasto=0, não é omitido', () => {
  const gastos = [];
  const clientesPorCanal = [{ canal: 'Indicação', total: 5 }];
  const r = calcularCustoAquisicao(gastos, clientesPorCanal);
  assert.equal(r.length, 1);
  assert.equal(r[0].gasto, 0);
  assert.equal(r[0].custo_por_cliente, 0, 'gasto 0 com clientes > 0 => custo 0, é o canal mais barato');
});

test('canal com gasto mas zero clientes fechados no mês: custo_por_cliente é null, não Infinity', () => {
  const gastos = [{ canal: 'Google Ads', valor: 500 }];
  const clientesPorCanal = [];
  const r = calcularCustoAquisicao(gastos, clientesPorCanal);
  assert.equal(r.length, 1);
  assert.equal(r[0].canal, 'Google Ads');
  assert.equal(r[0].gasto, 500);
  assert.equal(r[0].clientes, 0);
  assert.equal(r[0].custo_por_cliente, null, 'sem cliente nenhum, não dá pra calcular custo — null, não Infinity');
});

test('canal que aparece nos dois lados (gasto e clientes) não duplica linha', () => {
  const gastos = [{ canal: 'Meta Ads', valor: 900 }];
  const clientesPorCanal = [{ canal: 'Meta Ads', total: 3 }];
  const r = calcularCustoAquisicao(gastos, clientesPorCanal);
  assert.equal(r.filter((x) => x.canal === 'Meta Ads').length, 1);
});
