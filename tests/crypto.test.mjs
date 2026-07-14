import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Chave de teste (não é a de produção)
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'jwt-secret-de-teste-antigo';

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

// ── Backup: o dump vai cifrado para o MEGA ─────────────────────────────────
const { encryptBuffer, decryptBuffer, isEncryptedBuffer } = await import('../dist/utils/crypto.js');
const zlib = await import('node:zlib');

// Simula um dump com dado sensível de verdade (é isso que vaza se o MEGA cair)
const DUMP = Buffer.from(
  "INSERT INTO clients VALUES (1,'Maria','031.918.597-48');\n" +
  "INSERT INTO documents VALUES (1,'LAUDO_MEDICO.pdf');\nCREATE TABLE x();"
);

test('backup: o dump cifrado não contém o CPF nem o laudo em claro', () => {
  const enc = encryptBuffer(zlib.gzipSync(DUMP));
  const texto = enc.toString('latin1');
  assert.ok(!texto.includes('031.918.597-48'), 'CPF não pode aparecer no arquivo');
  assert.ok(!texto.includes('LAUDO_MEDICO'), 'nome do laudo não pode aparecer');
  assert.ok(isEncryptedBuffer(enc), 'deve ter a assinatura de cifrado');
});

test('backup: ciclo completo cifra → gzip → decifra → dump original', () => {
  const enc = encryptBuffer(zlib.gzipSync(DUMP));
  const sql = zlib.gunzipSync(decryptBuffer(enc));
  assert.equal(sql.toString(), DUMP.toString());
  assert.ok(sql.toString().includes('CREATE TABLE'), 'a restauração precisa achar CREATE TABLE');
});

test('backup ANTIGO (não cifrado) continua restaurando — retrocompatível', () => {
  // Os 30 backups já no MEGA estão em claro. Não podem parar de restaurar.
  const antigo = zlib.gzipSync(DUMP);
  assert.ok(!isEncryptedBuffer(antigo));
  const sql = zlib.gunzipSync(decryptBuffer(antigo)); // passa intacto
  assert.equal(sql.toString(), DUMP.toString());
});

test('backup adulterado é rejeitado (não restaura lixo por cima do banco)', () => {
  const enc = encryptBuffer(zlib.gzipSync(DUMP));
  enc[enc.length - 1] ^= 0xff; // vira 1 bit
  assert.throws(() => decryptBuffer(enc), 'deve lançar, não devolver dados corrompidos');
});

// ── TROCA DE CHAVE: o cenário real que quebrou o CRM em produção ────────────
// O sistema rodou primeiro SEM ENCRYPTION_KEY (chave derivada do JWT_SECRET) e
// cifrou os tokens. Depois a ENCRYPTION_KEY foi definida — e os tokens, cifrados
// com a chave antiga, ficariam ILEGÍVEIS: Gmail, Drive e Agenda parariam.
const { podeDecifrar, chaveLegada, decryptComChave } = await import('../dist/utils/crypto.js');

test('token cifrado com a CHAVE ANTIGA é detectado como ilegível (não passa batido)', () => {
  // Simula: cifra com a chave derivada do JWT_SECRET
  const legada = chaveLegada();
  assert.ok(legada, 'deve haver chave legada quando existe JWT_SECRET');

  // Recria o formato enc:v1 usando a chave legada
  const cryptoNode = require('node:crypto');
  const iv = cryptoNode.randomBytes(12);
  const c = cryptoNode.createCipheriv('aes-256-gcm', legada, iv);
  const cifra = Buffer.concat([c.update(TOKEN, 'utf8'), c.final()]);
  const comChaveAntiga = 'enc:v1:' + iv.toString('base64') + ':' + c.getAuthTag().toString('base64') + ':' + cifra.toString('base64');

  // Tem a MARCA de cifrado...
  assert.ok(isEncrypted(comChaveAntiga));
  // ...mas NÃO abre com a chave atual. Era exatamente isto que meu painel não via.
  assert.equal(podeDecifrar(comChaveAntiga), false, 'precisa acusar que não abre');
  assert.equal(decrypt(comChaveAntiga), null);

  // E o auto-reparo consegue abrir com a chave antiga → dá para re-cifrar.
  assert.equal(decryptComChave(comChaveAntiga, legada), TOKEN,
    'a chave legada precisa abrir — é assim que o boot migra sem reconectar as contas');
});

test('token cifrado com a chave ATUAL é legível (podeDecifrar = true)', () => {
  assert.equal(podeDecifrar(encrypt(TOKEN)), true);
});

test('texto puro é sempre "legível" (não é erro de chave)', () => {
  assert.equal(podeDecifrar(TOKEN), true);
});
