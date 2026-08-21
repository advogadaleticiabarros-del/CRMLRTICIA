// tests/whatsappTranscricao.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/whatsappTranscricao.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { transcreverAudio } = await import('../dist/services/whatsappTranscricao.js');

test('transcreverAudio devolve erro quando GROQ_API_KEY não está configurada', async () => {
  const originalKey = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  try {
    const r = await transcreverAudio({ id: 1, file_name: 'audio.ogg', mime: 'audio/ogg', data: Buffer.from('x') });
    assert.equal(r.ok, false);
    assert.match(r.erro, /GROQ_API_KEY/);
  } finally {
    if (originalKey) process.env.GROQ_API_KEY = originalKey;
  }
});

test('transcreverAudio recusa arquivo que não é áudio/vídeo', async () => {
  process.env.GROQ_API_KEY = 'chave-de-teste';
  try {
    const r = await transcreverAudio({ id: 2, file_name: 'foto.jpg', mime: 'image/jpeg', data: Buffer.from('x') });
    assert.equal(r.ok, false);
    assert.match(r.erro, /áudio/i);
  } finally {
    delete process.env.GROQ_API_KEY;
  }
});
