import { test } from 'node:test';
import assert from 'node:assert/strict';

// Chave de teste (não é a de produção)
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

const { encrypt, decrypt, isEncrypted } = await import('../dist/utils/crypto.js');

const TOKEN = 'ya29.a0AfB_TOKEN_SUPER_SECRETO_DO_GOOGLE';

test('cifra o token e não deixa o valor em claro', () => {
  const c = encrypt(TOKEN);
  assert.notEqual(c, TOKEN);
  assert.ok(isEncrypted(c), 'deve ter o prefixo enc:v1:');
  assert.ok(!c.includes('SUPER_SECRETO'), 'o token não pode aparecer em claro');
});

test('decifra e recupera o token original', () => {
  assert.equal(decrypt(encrypt(TOKEN)), TOKEN);
});

test('RETROCOMPATÍVEL: token antigo em texto puro passa intacto', () => {
  // Isto é o que impede o deploy de quebrar: tokens gravados antes da cifragem
  // continuam sendo lidos normalmente.
  assert.equal(decrypt(TOKEN), TOKEN);
});

test('idempotente: não cifra duas vezes', () => {
  const c = encrypt(TOKEN);
  assert.equal(encrypt(c), c);
});

test('IV aleatório: duas cifras do mesmo valor são diferentes', () => {
  assert.notEqual(encrypt(TOKEN), encrypt(TOKEN));
});

test('null e vazio são preservados como estão', () => {
  // No banco, '' e NULL são coisas diferentes — a cifragem não pode confundi-las.
  assert.equal(encrypt(null), null);
  assert.equal(decrypt(null), null);
  assert.equal(encrypt(''), '');
  assert.equal(decrypt(''), '');
});

test('detecta adulteração (AES-GCM autentica) e devolve null, não lixo', () => {
  const c = encrypt(TOKEN);
  const adulterado = c.slice(0, -4) + 'XXXX';
  assert.equal(decrypt(adulterado), null);
});
