// Ideia 7 da auditoria de Processos e prazos (28/09/2026): a fase sugerida
// (pelas movimentações) divergia da fase manual e só aparecia um selo na tela
// de Processos — quem não abria a tela nunca percebia. Agora um aviso sai
// quando a divergência persiste por 3+ dias e se repete a cada 14 dias.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const svcPath = path.resolve('src/services/faseDivergenteService.ts');
const svc = fs.existsSync(svcPath) ? fs.readFileSync(svcPath, 'utf8') : '';
const crons = fs.readFileSync(path.resolve('src/crons/index.ts'), 'utf8');

test('serviço compara só quando a sugerida está À FRENTE da manual (PHASE_RANK)', () => {
  assert.match(svc, /export async function alertarFaseDivergente/);
  assert.match(svc, /PHASE_RANK/);
  assert.match(svc, /suggested_phase IS NOT NULL/);
});

test('primeira vez só marca; avisa depois de 3 dias e repete a cada 14 (chaves em sent_reminders)', () => {
  assert.match(svc, /fase_div_visto_/);
  assert.match(svc, /fase_div_aviso_/);
  assert.match(svc, /INSERT IGNORE INTO sent_reminders/);
  assert.match(svc, /dias < 3/);
  assert.match(svc, /\/ 14/);
});

test('agendado no cron diário', () => {
  assert.match(crons, /processos:fase-divergente/);
  assert.match(crons, /alertarFaseDivergente/);
});

test('SQL não referencia tabela/coluna inexistente', () => {
  if (!svc) return assert.fail('serviço não existe');
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([svcPath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});
