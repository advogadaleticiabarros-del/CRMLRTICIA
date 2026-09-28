// Ideias 4 e 5 da auditoria de Processos e prazos (28/09/2026):
// 4) o aviso de prazo próximo repetia igual a cada hora, sem ficar mais forte
//    conforme apertava; 5) ao virar "vencido" só mudava a cor na lista.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const cronPath = path.resolve('src/crons/index.ts');
const crons = fs.readFileSync(cronPath, 'utf8');
const ini = crons.indexOf('async function generateDeadlineAlerts');
const fim = crons.indexOf('async function alertUpcomingEvents');
const alertas = crons.slice(ini, fim);

test('aviso de prazo próximo escala o título pelo nível de urgência', () => {
  assert.match(alertas, /nivelUrgencia/);
  assert.match(alertas, /🚨/);
});

test('prazo com mais de 24h repete menos (6h) que o de menos de 24h (1h)', () => {
  assert.match(alertas, /INTERVAL \(CASE/);
  assert.match(alertas, /THEN 1 ELSE 6 END\) HOUR/);
});

test('existe aviso próprio, uma única vez, quando o prazo vence', () => {
  assert.match(crons, /async function alertOverdueDeadlines/);
  const i = crons.indexOf('async function alertOverdueDeadlines');
  const bloco = crons.slice(i, i + 2500);
  assert.match(bloco, /'prazo_vencido'/);
  assert.match(bloco, /deadline_date < NOW\(\)/);
  assert.match(bloco, /NOT EXISTS/);
  assert.match(bloco, /INTERVAL 2 DAY/);
  assert.match(crons, /prazos:vencidos/);
});

test('SQL não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([cronPath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});
