// Ideia 3 da auditoria de Processos e prazos: se a rotina de monitoramento
// parar de rodar (travou, servidor lento), ninguém era avisado — só dava pra
// perceber abrindo a tela de saúde das rotinas. Vigia confere job_runs e
// avisa os admins (via runJob crítico) quando não houve NENHUMA rodada ok.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const crons = fs.readFileSync(path.resolve('src/crons/index.ts'), 'utf8');

test('existe o vigia do monitoramento, crítico', () => {
  const idx = crons.indexOf("'monitoramento:vigia'");
  assert.notEqual(idx, -1, 'vigia não encontrado');
  const bloco = crons.slice(idx - 200, crons.indexOf('}, {', idx) + 60);
  assert.match(bloco, /critica:\s*true/);
});

test('vigia olha as rodadas ok do monitoramento em job_runs numa janela de 6h', () => {
  const idx = crons.indexOf("'monitoramento:vigia'");
  const bloco = crons.slice(idx, idx + 1200);
  assert.match(bloco, /FROM job_runs/);
  assert.match(bloco, /monitoramento:processos/);
  assert.match(bloco, /status = 'ok'/);
  assert.match(bloco, /INTERVAL 6 HOUR/);
  assert.match(bloco, /throw new Error/);
});

test('vigia roda em horário em que o monitoramento (07h–20h) deveria ter rodado', () => {
  const idx = crons.indexOf("'monitoramento:vigia'");
  const antes = crons.slice(idx - 300, idx);
  assert.match(antes, /cron\.schedule\('30 13,20 \* \* \*'/);
});
