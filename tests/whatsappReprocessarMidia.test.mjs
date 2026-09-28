// tests/whatsappReprocessarMidia.test.mjs
// Bug real reportado pela Dra. Letícia (25/09/2026): uma rajada de mídias
// (7 fotos + 3 áudios + 1 ptt) de uma cliente falhou ao baixar da Uazapi —
// a conversa só registrou o aviso "falhou ao baixar", sem o arquivo.
// O messageId da Uazapi É guardado mesmo quando o download falha
// (whatsapp_messages.message_id, ver whatsapp-webhook.ts) — então dá pra
// TENTAR DE NOVO mais tarde, sem precisar pedir reenvio pro cliente,
// reaproveitando a mesma função storeMedia que o webhook já usa.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const webhookPath = path.resolve('src/routes/whatsapp-webhook.ts');
const instancePath = path.resolve('src/routes/whatsapp-instance.ts');
const webhookSrc = fs.readFileSync(webhookPath, 'utf8');
const instanceSrc = fs.readFileSync(instancePath, 'utf8');

test('storeMedia é exportado de whatsapp-webhook.ts (reuso pelo reprocessamento)', () => {
  assert.match(webhookSrc, /export async function storeMedia/);
});

test('rota de reprocessar mídia existe em whatsapp-instance.ts', () => {
  assert.match(instanceSrc, /reprocessar-midia/);
});

test('rota de reprocessar mídia importa e usa storeMedia + normalizeMediaType do webhook', () => {
  assert.match(instanceSrc, /from '\.\/whatsapp-webhook'/);
  const idx = instanceSrc.indexOf('reprocessar-midia');
  const inicio = instanceSrc.lastIndexOf("router.post(", idx);
  const fim = instanceSrc.indexOf('\n});', idx);
  const bloco = instanceSrc.slice(inicio, fim);
  assert.match(bloco, /storeMedia\(/);
  assert.match(bloco, /message_id/);
  assert.match(bloco, /media_id/);
});

test('rota recusa reprocessar mensagem que já tem mídia salva', () => {
  const idx = instanceSrc.indexOf('reprocessar-midia');
  const inicio = instanceSrc.lastIndexOf("router.post(", idx);
  const fim = instanceSrc.indexOf('\n});', idx);
  const bloco = instanceSrc.slice(inicio, fim);
  assert.match(bloco, /msg\.media_id/);
});

test('SQL de whatsapp-instance.ts não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([instancePath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});

test('tela do WhatsApp mostra botão "Tentar baixar de novo" pra mídia que falhou', () => {
  const frontSrc = fs.readFileSync(path.resolve('public/whatsapp.js'), 'utf8');
  assert.match(frontSrc, /data-reprocessar-midia/);
  assert.match(frontSrc, /reprocessar-midia.*method:\s*'POST'|\/reprocessar-midia`/);
});
