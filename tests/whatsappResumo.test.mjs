// tests/whatsappResumo.test.mjs
// Confirma que a rota de resumo chama garantirMidiaTranscrita() ANTES de montar
// o texto da conversa — sem isso, mídia pendente nunca entraria no resumo.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve('src/routes/whatsapp-instance.ts'), 'utf8');

test('POST /chats/:phone/resumo chama garantirMidiaTranscrita antes de conversaTexto', () => {
  const m = src.match(/router\.post\('\/chats\/:phone\/resumo'[\s\S]*?\}\);/);
  assert.ok(m, 'rota /chats/:phone/resumo não encontrada');
  const corpo = m[0];
  const idxGarantir = corpo.indexOf('garantirMidiaTranscrita');
  const idxConversaTexto = corpo.indexOf('conversaTexto(');
  assert.ok(idxGarantir > -1, 'rota não chama garantirMidiaTranscrita');
  assert.ok(idxConversaTexto > -1, 'rota não chama conversaTexto');
  assert.ok(idxGarantir < idxConversaTexto, 'garantirMidiaTranscrita deve ser chamada ANTES de conversaTexto');
});
