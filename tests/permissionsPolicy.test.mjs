// Bug real: o header Permissions-Policy bloqueava microfone e geolocalização
// pro domínio inteiro (camera=(), microphone=(), geolocation=()) — mesmo a
// usuária liberando no navegador e no Windows, a gravação de áudio no
// WhatsApp (whatsapp.js) e a geolocalização na assinatura eletrônica
// (assinar.html, prova jurídica de onde o signatário assinou) ficavam
// silenciosamente quebradas, porque o header do servidor tem prioridade
// sobre qualquer permissão concedida no navegador.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const appTs = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
const linha = appTs.split('\n').find((l) => l.includes("setHeader('Permissions-Policy'"));

test('Permissions-Policy existe em app.ts', () => {
  assert.ok(linha, 'header Permissions-Policy não encontrado em app.ts');
});

test('microfone liberado só pra este domínio (self) — gravação de áudio no WhatsApp depende disso', () => {
  assert.match(linha, /microphone=\(self\)/);
});

test('geolocalização liberada só pra este domínio (self) — prova de assinatura eletrônica depende disso', () => {
  assert.match(linha, /geolocation=\(self\)/);
});

test('câmera continua bloqueada — nenhuma tela do CRM usa câmera', () => {
  assert.match(linha, /camera=\(\)/);
});
