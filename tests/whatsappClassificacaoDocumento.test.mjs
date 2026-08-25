// tests/whatsappClassificacaoDocumento.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/whatsappTranscricao.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { classificarTipoDocumento } = await import('../dist/services/whatsappTranscricao.js');

test('classifica corretamente quando a IA devolve um valor da lista fixa', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'fake-key';
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: 'rg' }] } }] }),
  });
  try {
    const media = { id: 1, file_name: 'foto.jpg', mime: 'image/jpeg', data: Buffer.from('fake') };
    const r = await classificarTipoDocumento(media);
    assert.equal(r, 'rg');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('valor fora da lista fixa vira null, não é gravado como está', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'fake-key';
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: 'não tenho certeza, parece ser um boleto' }] } }] }),
  });
  try {
    const media = { id: 1, file_name: 'foto.jpg', mime: 'image/jpeg', data: Buffer.from('fake') };
    const r = await classificarTipoDocumento(media);
    assert.equal(r, null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('falha da IA (sem chave configurada) devolve null, não lança erro', async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const media = { id: 1, file_name: 'foto.jpg', mime: 'image/jpeg', data: Buffer.from('fake') };
    const r = await classificarTipoDocumento(media);
    assert.equal(r, null);
  } finally {
    if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
  }
});

test('mime não suportado (áudio) devolve null sem chamar a IA', async () => {
  const originalFetch = globalThis.fetch;
  let chamouFetch = false;
  globalThis.fetch = async () => { chamouFetch = true; return { ok: true, json: async () => ({}) }; };
  try {
    const media = { id: 1, file_name: 'audio.ogg', mime: 'audio/ogg', data: Buffer.from('fake') };
    const r = await classificarTipoDocumento(media);
    assert.equal(r, null);
    assert.equal(chamouFetch, false, 'não deveria nem tentar chamar a IA para um mime não suportado');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
