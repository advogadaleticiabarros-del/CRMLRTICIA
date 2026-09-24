// tests/retentionAccessLogs.test.mjs
// Ideia 14 (prioridade baixa) da auditoria do módulo Clientes (23/09/2026):
// access_logs (trilha de auditoria LGPD, migration 059) nunca teve política de
// retenção — crescia pra sempre. src/services/retentionService.ts já existia
// pra outras tabelas, mas access_logs não estava nem lá dentro nem na lista de
// INTOCADAS. Prazo escolhido: 5 anos — é o mesmo prazo prescricional que a
// própria LGPD usa pra apuração administrativa da ANPD (art. 52, §5º), ou
// seja, o log de acesso precisa sobreviver pelo menos esse tempo pra provar
// conformidade se for cobrado, mas não faz sentido guardar pra sempre depois.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const srcPath = path.resolve('src/services/retentionService.ts');
const src = fs.readFileSync(srcPath, 'utf8');

test('retentionService define política pra access_logs', () => {
  assert.match(src, /access_logs/);
});

test('política de access_logs usa prazo de 5 anos (1825 dias)', () => {
  const idx = src.indexOf("tabela: 'access_logs'");
  assert.notEqual(idx, -1, 'política de access_logs não encontrada em POLITICAS');
  const inicio = src.lastIndexOf('{', idx);
  const fim = src.indexOf('},', idx);
  const bloco = src.slice(inicio, fim);
  assert.match(bloco, /DIAS\.logsAcesso/);
  assert.match(bloco, /DELETE FROM access_logs/);
  assert.match(src, /logsAcesso:\s*1825/);
});

test('access_logs não está na lista de tabelas INTOCADAS (ela tem, sim, política de expurgo)', () => {
  const idx = src.indexOf('export const INTOCADAS');
  const fim = src.indexOf('];', idx);
  const bloco = src.slice(idx, fim);
  assert.doesNotMatch(bloco, /'access_logs'/);
});
