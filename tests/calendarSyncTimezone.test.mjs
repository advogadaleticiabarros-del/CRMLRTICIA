// Google Calendar devolve dateTime com offset embutido (RFC3339). Gravar essa
// string direto no banco (pool timezone:'Z', tudo lido como UTC) desloca o
// horário — mesma classe de bug já corrigida em calendar.ts (commit a305ad0)
// e no sentido CRM→Google (commit 97983b6), nunca corrigida no sentido
// Google→CRM.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/CalendarSyncService.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { toUtcMysqlFromGoogleDateTime } = await import('../dist/services/CalendarSyncService.js');

test('14:00 em -03:00 (Brasília) vira 17:00 em UTC no formato MySQL', () => {
  assert.equal(toUtcMysqlFromGoogleDateTime('2026-08-25T14:00:00-03:00'), '2026-08-25 17:00:00');
});

test('horário já em Z (UTC) passa direto, só troca o formato', () => {
  assert.equal(toUtcMysqlFromGoogleDateTime('2026-08-25T17:00:00Z'), '2026-08-25 17:00:00');
});

test('evento de dia inteiro (só data, sem hora) vira meia-noite UTC daquele dia', () => {
  assert.equal(toUtcMysqlFromGoogleDateTime('2026-08-25'), '2026-08-25 00:00:00');
});

test('nulo/indefinido devolve null', () => {
  assert.equal(toUtcMysqlFromGoogleDateTime(null), null);
  assert.equal(toUtcMysqlFromGoogleDateTime(undefined), null);
});
