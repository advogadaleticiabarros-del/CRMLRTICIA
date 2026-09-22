// tests/whatsappQueuePriority.test.mjs
// scheduleAutoSend (uazapiInstance.ts) drena whatsapp_queue por prioridade de
// contexto (audiência > avulsa > cobrança) antes de created_at — sem isso, um
// lembrete de audiência pode ficar preso na fila atrás de cobranças de rotina
// dentro do teto diário de 30 envios (achado na auditoria de fluxos do
// WhatsApp, 22/09/2026). Teste estático: audita a query fonte, sem precisar
// de banco (o comportamento de runtime depende só desse SQL).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve('src/services/uazapiInstance.ts'), 'utf8');
const m = src.match(/SELECT id, phone, message FROM whatsapp_queue[\s\S]*?LIMIT 1/);

test('fila de envio automático existe e seleciona 1 pendente', () => {
  assert.ok(m, 'query de drenagem da fila não encontrada em uazapiInstance.ts');
});

test('fila prioriza audiência sobre avulsa e cobrança antes de created_at', () => {
  const q = m[0];
  assert.match(q, /status = 'pendente'/);
  const orderBy = q.match(/ORDER BY ([\s\S]*)/)[1];
  const posAudiencia = orderBy.indexOf("'audiencia'");
  const posAvulsa = orderBy.indexOf("'avulsa'");
  const posCreatedAt = orderBy.indexOf('created_at');
  assert.ok(posAudiencia >= 0 && posAvulsa >= 0, 'ORDER BY precisa distinguir audiencia e avulsa');
  assert.ok(posCreatedAt > posAudiencia && posCreatedAt > posAvulsa,
    'created_at deve ser desempate, nunca o critério principal — senão volta a ser FIFO puro');
});
