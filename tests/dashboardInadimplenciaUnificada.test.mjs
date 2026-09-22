// tests/dashboardInadimplenciaUnificada.test.mjs
// Auditoria do Dashboard (22/09/2026) encontrou "Inadimplência" calculada de
// 4 jeitos diferentes. Unificados: Cockpit e o topo do Financeiro agora usam
// a MESMA função (getFinanceSummary().inadimplencia); o painel de aging
// (getInadimplencia) passou a somar as mesmas 6 fontes, não só 3. A 4ª
// definição (aba Inadimplência, tabela `inadimplencias`) continua com escopo
// próprio de propósito (fila de cobrança acionável só de parcelas de
// cliente) — ver o teste que confirma isso explicitamente.
// Testes estáticos (auditam o código-fonte, sem precisar de banco).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const cockpitPath = path.resolve('src/routes/dashboards/cockpit.ts');
const monthlyPath = path.resolve('src/services/monthlyFinance.ts');
const inadPath = path.resolve('src/routes/inadimplencias.ts');
const cronPath = path.resolve('src/crons/index.ts');
const cockpitSrc = fs.readFileSync(cockpitPath, 'utf8');
const monthlySrc = fs.readFileSync(monthlyPath, 'utf8');
const inadSrc = fs.readFileSync(inadPath, 'utf8');
const cronSrc = fs.readFileSync(cronPath, 'utf8');

test('SQL novo da unificação não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([cockpitPath, monthlyPath, inadPath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});

test('Cockpit usa getFinanceSummary() como fonte de "vencido" (Inadimplência), não uma soma própria', () => {
  assert.match(cockpitSrc, /import \{ getFinanceSummary \} from '\.\.\/\.\.\/services\/financeSummary'/);
  assert.match(cockpitSrc, /vencido:\s*Number\(resumo\.inadimplencia\)/);
  // não pode mais somar "vencido" das 6 queries por conta própria
  const bloco = cockpitSrc.match(/const financeiro = await safe\(async \(\) => \{[\s\S]*?\n  \}, \{ receber_hoje: 0/);
  assert.ok(bloco, 'bloco financeiro do cockpit não encontrado');
  assert.doesNotMatch(bloco[0], /Number\(fr\.vencido\)/, 'não pode mais recalcular vencido por conta própria');
});

test('getInadimplencia() (aging) soma as mesmas 6 fontes de getFinanceSummary, não só 3', () => {
  const fn = monthlySrc.match(/export async function getInadimplencia[\s\S]*?\n\}/);
  assert.ok(fn, 'getInadimplencia não encontrada');
  for (const tabela of ['financial_records', 'installments', 'parcelas', 'correspondent_hearings', 'dative_payments', 'case_awards']) {
    assert.match(fn[0], new RegExp(tabela), `getInadimplencia deveria somar ${tabela}`);
  }
});

test('recalcularInadimplencias() foi extraída da rota pra também rodar num cron diário', () => {
  assert.match(inadSrc, /export async function recalcularInadimplencias/);
  assert.match(cronSrc, /recalcularInadimplencias/);
  assert.match(cronSrc, /financeiro:inadimplencia-recalcular/);
});

test('a fila de cobrança (aba Inadimplência) continua com escopo próprio — só parcelas de cliente', () => {
  // Confirma que a unificação NÃO tentou forçar as 6 fontes dentro da fila
  // acionável (correspondente/dativo/parcerias não têm "renegociar parcela").
  const fn = inadSrc.match(/export async function recalcularInadimplencias[\s\S]*?\n\}/);
  assert.ok(fn, 'recalcularInadimplencias não encontrada');
  assert.match(fn[0], /FROM parcelas p/);
  assert.doesNotMatch(fn[0], /correspondent_hearings|dative_payments|case_awards/);
});

test('"Total a protocolar" e "Peças pendentes" usam a mesma função compartilhada', () => {
  const processualSrc = fs.readFileSync(path.resolve('src/routes/dashboards/processual.ts'), 'utf8');
  assert.match(cockpitSrc, /totalAProtocolarSql\(\)/);
  assert.match(processualSrc, /totalAProtocolarSql\('pendentes'\)/);
});

test('"Resolver" numa movimentação a verificar fecha o alerta de vez (movement_alerts), não só a soneca de 1 dia', () => {
  const fn = cockpitSrc.match(/router\.post\('\/resolver'[\s\S]*?\n\}\);/);
  assert.ok(fn, "rota POST /resolver não encontrada");
  assert.match(fn[0], /UPDATE movement_alerts SET status = 'resolvido'/);
});
