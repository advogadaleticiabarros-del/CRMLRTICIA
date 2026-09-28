// Erro persistente reportado (25/09/2026): rajada de mídias "falhou ao baixar".
// Antes: 1 tentativa só, motivo da falha perdido (só console), recuperação
// dependia de alguém clicar. Agora: retry com espera, fallback por fileURL,
// motivo no aviso do sino e varredura automática que recupera sozinha.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const webhookPath = path.resolve('src/routes/whatsapp-webhook.ts');
const webhook = fs.readFileSync(webhookPath, 'utf8');
const crons = fs.readFileSync(path.resolve('src/crons/index.ts'), 'utf8');
const instance = fs.readFileSync(path.resolve('src/routes/whatsapp-instance.ts'), 'utf8');

test('download de mídia tenta mais de uma vez antes de desistir', () => {
  assert.match(webhook, /TENTATIVAS_DOWNLOAD\s*=\s*[3-9]/);
  assert.match(webhook, /for \(let tentativa = 1; tentativa <= TENTATIVAS_DOWNLOAD/);
});

test('download aceita fileURL quando a Uazapi não devolve base64', () => {
  assert.match(webhook, /dl\.fileURL/);
});

test('aviso no sino inclui o motivo real da falha', () => {
  assert.match(webhook, /avisarFalhaMidia\(msg\.messageType,\s*motivo/);
  assert.match(webhook, /Motivo:/);
});

test('reprocessarMidiasFalhadas existe e é exportada', () => {
  assert.match(webhook, /export async function reprocessarMidiasFalhadas/);
  assert.match(webhook, /export async function reprocessarMensagemMidia/);
});

test('varredura automática agendada em crons/index.ts', () => {
  assert.match(crons, /whatsapp:midias-falhadas/);
  assert.match(crons, /reprocessarMidiasFalhadas/);
});

test('rota manual reaproveita reprocessarMensagemMidia', () => {
  assert.match(instance, /reprocessarMensagemMidia/);
});

test('SQL não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([webhookPath, path.resolve('src/routes/whatsapp-instance.ts')]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});
