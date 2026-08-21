// Valida que as 4 novas funções de dado do briefing referenciam colunas/
// tabelas que de fato existem no schema — mesmo padrão de tests/dashboards.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/morningBriefingService.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const mod = await import('../dist/services/morningBriefingService.js');

test('getAgenda3Dias, getFinanceiroGranular, getComercialDoDia e getEsteiraEDocumentos são exportadas', () => {
  assert.equal(typeof mod.getAgenda3Dias, 'function');
  assert.equal(typeof mod.getFinanceiroGranular, 'function');
  assert.equal(typeof mod.getComercialDoDia, 'function');
  assert.equal(typeof mod.getEsteiraEDocumentos, 'function');
});

// Colunas referenciadas pelas novas queries precisam existir nas migrations.
const schemaSql = readdirSync(new URL('../migrations', import.meta.url))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'))
  .join('\n');

test('clients.birth_date existe (migration 095)', () => {
  assert.match(schemaSql, /birth_date\s+DATE/i);
});
test('cases.checklist_checked existe (migration 065, reaproveitada)', () => {
  assert.match(schemaSql, /checklist_checked\s+JSON/i);
});
test('cases.production_stage e production_started_at existem (migrations 010/044)', () => {
  assert.match(schemaSql, /production_stage\s+ENUM/i);
  assert.match(schemaSql, /production_started_at/i);
});
