// tests/metaDoMesUnificada.test.mjs
// Achado da pesquisa de 22/09/2026: existia um motor de meta mensal completo
// (goalsService.ts — aumenta 10% sozinho ao bater o mês, conta contratos
// fechados) com API pronta (GET/PUT /api/goals/current), mas a tela de
// Visão Geral do Financeiro calculava meta/recebido do zero a partir de
// office_settings + projeção de caixa — um número que podia divergir do que
// o briefing matinal mostrava (que já usava getGoalProgress()). Corrigido:
// a tela agora usa a mesma API. Teste estático (audita o código-fonte).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve('public/app.js'), 'utf8');

test('finVisaoGeral usa GET /api/goals/current pra meta/recebido, não office_settings + cashflow', () => {
  const fn = src.match(/async function finVisaoGeral\(c\)[\s\S]*?const metaHtml = meta \? `[\s\S]*?` : '';/);
  assert.ok(fn, 'finVisaoGeral não encontrada');
  assert.match(fn[0], /api\('\/api\/goals\/current'\)/);
  assert.doesNotMatch(fn[0], /os\.meta_faturamento_mes/, 'não pode mais calcular a meta a partir de office_settings direto');
  assert.doesNotMatch(fn[0], /proj\.entrada_realizado/, 'não pode mais usar a projeção de caixa como "recebido" da meta');
});

test('editar a meta em Configurações também atualiza monthly_goals (PUT /api/goals/current)', () => {
  const fn = src.match(/\$\('#os-save'\)\.onclick = async \(\) => \{[\s\S]*?\n    \};/);
  assert.ok(fn, "handler de '#os-save' não encontrado");
  assert.match(fn[0], /api\('\/api\/goals\/current', \{ method: 'PUT'/);
});
