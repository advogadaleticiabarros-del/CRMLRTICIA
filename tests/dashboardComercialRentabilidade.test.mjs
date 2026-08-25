// tests/dashboardComercialRentabilidade.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/routes/dashboards/comercial.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { calcularRentabilidadeArea } = await import('../dist/routes/dashboards/comercial.js');

test('calcula receita média por caso corretamente', () => {
  const linhas = [
    { legal_area: 'trabalhista', total_casos: 4, receita_total: 8000 },
    { legal_area: 'familia', total_casos: 2, receita_total: 9000 },
  ];
  const r = calcularRentabilidadeArea(linhas);
  assert.equal(r.length, 2);
  assert.equal(r[0].receita_media_caso, 2000, '8000/4 = 2000');
  assert.equal(r[1].receita_media_caso, 4500, '9000/2 = 4500');
});

test('área sem nenhum caso (total_casos=0) não gera divisão por zero', () => {
  const linhas = [{ legal_area: 'consumidor', total_casos: 0, receita_total: 0 }];
  const r = calcularRentabilidadeArea(linhas);
  assert.equal(r[0].receita_media_caso, 0, 'sem casos, média é 0, não NaN/Infinity');
});

test('preserva receita_total e total_casos sem alteração', () => {
  const linhas = [{ legal_area: 'civel', total_casos: 3, receita_total: 4500 }];
  const r = calcularRentabilidadeArea(linhas);
  assert.equal(r[0].legal_area, 'civel');
  assert.equal(r[0].total_casos, 3);
  assert.equal(r[0].receita_total, 4500);
});

test('área com casos mas sem nenhuma installment paga: receita_total e média ficam 0', () => {
  const linhas = [{ legal_area: 'previdenciario', total_casos: 3, receita_total: 0 }];
  const r = calcularRentabilidadeArea(linhas);
  assert.equal(r[0].total_casos, 3);
  assert.equal(r[0].receita_total, 0);
  assert.equal(r[0].receita_media_caso, 0);
});
