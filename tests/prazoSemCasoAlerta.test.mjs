// Ideia 2 (prioridade alta) da auditoria de Processos e prazos: prazo confirmado
// em processo SEM caso vinculado não entra na lista de Prazos nem nos avisos
// 30/15/7/3/1 — só existia uma tarefa comum. Agora um alerta diário escala
// conforme o vencimento se aproxima, até alguém vincular o processo.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const svcPath = path.resolve('src/services/prazoSemCasoService.ts');
const svc = fs.existsSync(svcPath) ? fs.readFileSync(svcPath, 'utf8') : '';
const crons = fs.readFileSync(path.resolve('src/crons/index.ts'), 'utf8');

test('serviço existe e busca prazos confirmados de processo sem caso, ainda não vencidos', () => {
  assert.match(svc, /export async function alertarPrazosSemCaso/);
  assert.match(svc, /detected_deadlines/);
  assert.match(svc, /status = 'confirmado'/);
  assert.match(svc, /case_id IS NULL/);
  assert.match(svc, /due_date >= CURDATE\(\)/);
});

test('escala o título pelo nível de urgência e não repete no mesmo dia', () => {
  assert.match(svc, /nivelUrgencia/);
  assert.match(svc, /diasAte/);
  assert.match(svc, /INSERT IGNORE INTO sent_reminders/);
  assert.match(svc, /prazo_sem_caso_/);
});

test('avisa os admins pelo sino e agendado no cron diário como rotina crítica', () => {
  assert.match(svc, /notification_type|notificationType|'prazo_sem_caso'/);
  assert.match(crons, /prazos:sem-caso/);
  assert.match(crons, /alertarPrazosSemCaso/);
});

test('SQL não referencia tabela/coluna inexistente', () => {
  if (!svc) return assert.fail('serviço não existe');
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([svcPath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});
