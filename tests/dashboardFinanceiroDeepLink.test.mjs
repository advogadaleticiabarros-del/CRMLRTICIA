// tests/dashboardFinanceiroDeepLink.test.mjs
// Clicar num KPI do Cockpit (ex.: "Inadimplência") sempre caía na Visão
// geral do Financeiro, sem filtro nenhum — reportado 22/09/2026. Correção:
// router() aceita "#rota?tab=x" e ROUTES.financeiro abre direto na sub-aba
// pedida. Teste estático (audita o código-fonte, sem precisar de DOM real).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve('public/app.js'), 'utf8');

test('router() aceita parâmetro de sub-aba via "?" no hash', () => {
  const fn = src.match(/function router\(\)[\s\S]*?\n\}/);
  assert.ok(fn, 'router() não encontrada');
  assert.match(fn[0], /\.split\('\?'\)\[0\]/);
});

test('hashParam() existe e lê o parâmetro do hash atual', () => {
  const fn = src.match(/function hashParam\(nome\)[\s\S]*?\n\}/);
  assert.ok(fn, 'hashParam() não encontrada');
  assert.match(fn[0], /URLSearchParams/);
});

test('ROUTES.financeiro abre a sub-aba pedida em vez de sempre "geral"', () => {
  const fn = src.match(/async financeiro\(page\)[\s\S]*?\n  \},/);
  assert.ok(fn, 'ROUTES.financeiro não encontrada');
  assert.match(fn[0], /hashParam\('tab'\)/);
  assert.doesNotMatch(fn[0], /await show\('geral'\);\s*\}\s*,/, "não pode voltar a cair sempre em 'geral' incondicionalmente");
});

test('KPI de Inadimplência do Cockpit aponta pra sub-aba inadimplencia, não pra Visão geral', () => {
  const linha = src.match(/stat\('Inadimplência', f\.vencido,[^)]*\)/);
  assert.ok(linha, "KPI 'Inadimplência' não encontrado no Cockpit");
  assert.match(linha[0], /'financeiro\?tab=inadimplencia'/);
});
