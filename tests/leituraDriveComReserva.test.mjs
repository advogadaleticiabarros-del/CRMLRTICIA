// tests/leituraDriveComReserva.test.mjs — incidente de 30/10/2026: o extrato de empréstimos
// do Valmirio nunca era lido porque a leitura dos anexos do Drive usava só o Gemini
// gratuito (20 leituras/dia, esgotadas). A leitura dos documentos do caso tem de usar
// aiLerArquivo (Gemini e, sem cota, a OpenAI com visão).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('peticaoBuilder lê anexos do Drive com reserva (aiLerArquivo), nunca só pelo Gemini', () => {
  const src = fs.readFileSync(new URL('../src/services/peticaoBuilder.ts', import.meta.url), 'utf8');
  assert.ok(!/aiExtractFromFile\s*\(/.test(src), 'chamada direta a aiExtractFromFile (só Gemini) em peticaoBuilder.ts');
  assert.ok(/aiLerArquivo\s*\(/.test(src));
});
