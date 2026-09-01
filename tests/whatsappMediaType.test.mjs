// tests/whatsappMediaType.test.mjs
// Regressão do bug: mídia recebida no WhatsApp nunca era salva porque o
// webhook lia "msg.mediaType" (campo que não existe) em vez de
// "msg.messageType" (nome real, confirmado na doc oficial da Uazapi), e
// storeMedia() lia "dl.base64" em vez de "dl.base64Data" na resposta do
// /message/download. Ver src/routes/whatsapp-webhook.ts.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/routes/whatsapp-webhook.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { normalizeMediaType } = await import('../dist/routes/whatsapp-webhook.js');

test('normalizeMediaType: reconhece os tipos simples que a Uazapi manda hoje', () => {
  assert.strictEqual(normalizeMediaType('image'), 'image');
  assert.strictEqual(normalizeMediaType('document'), 'document');
  assert.strictEqual(normalizeMediaType('audio'), 'audio');
  assert.strictEqual(normalizeMediaType('ptt'), 'ptt');
  assert.strictEqual(normalizeMediaType('video'), 'video');
  assert.strictEqual(normalizeMediaType('sticker'), 'sticker');
});

test('normalizeMediaType: tolera maiúsculas/espaços e o sufixo "Message" (caso a Uazapi volte a mudar o formato)', () => {
  assert.strictEqual(normalizeMediaType('Image'), 'image');
  assert.strictEqual(normalizeMediaType(' IMAGE '), 'image');
  assert.strictEqual(normalizeMediaType('imageMessage'), 'image');
  assert.strictEqual(normalizeMediaType('audioMessage'), 'audio');
  assert.strictEqual(normalizeMediaType('documentMessage'), 'document');
});

test('normalizeMediaType: mensagem de texto puro ("conversation") não é tratada como mídia', () => {
  const norm = normalizeMediaType('conversation');
  assert.strictEqual(norm, 'conversation');
  // "conversation" não é uma chave em ROTULOS — o teste de integração real
  // fica em whatsappWebhookIntegration, aqui só garantimos que a
  // normalização não devolve algo que colida com um tipo de mídia real.
  assert.notStrictEqual(norm, 'image');
  assert.notStrictEqual(norm, 'audio');
});

test('normalizeMediaType: vazio/undefined/null devolve null (não string vazia)', () => {
  assert.strictEqual(normalizeMediaType(undefined), null);
  assert.strictEqual(normalizeMediaType(null), null);
  assert.strictEqual(normalizeMediaType(''), null);
  assert.strictEqual(normalizeMediaType('   '), null);
});
