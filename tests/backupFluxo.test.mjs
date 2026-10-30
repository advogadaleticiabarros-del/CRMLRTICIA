// tests/backupFluxo.test.mjs
// Backup em fluxo (30/10/2026): o dump passou de 900 MB e o backup, que fazia
// tudo na memória (ler, comprimir, cifrar, conferir), derrubava o CRM por falta
// de memória. Agora o arquivo é comprimido, cifrado e conferido em fluxo — e o
// formato precisa continuar o mesmo, senão a restauração e as cópias antigas param.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync, truncateSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);

if (!existsSync(new URL('../dist/services/backupService.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { cifrarArquivoEmFluxo, abrirBackupEmFluxo, encryptBuffer, decryptBuffer, isEncryptedBuffer } = await import('../dist/utils/crypto.js');
const { verificarArquivoBackup } = await import('../dist/services/backupService.js');

const TABELAS = ['clients', 'cases', 'legal_processes', 'financial_records', 'documents',
  ...Array.from({ length: 55 }, (_, i) => `tabela_${i}`)];
const DUMP = TABELAS.map((t) => `CREATE TABLE IF NOT EXISTS \`${t}\` (id int);\nINSERT INTO \`${t}\` VALUES (1);`).join('\n')
  + "\nINSERT INTO clients VALUES (1,'Maria','031.918.597-48');\n";

function pasta() { return mkdtempSync(path.join(os.tmpdir(), 'backup-fluxo-')); }

async function lerTudo(stream) {
  const partes = [];
  for await (const c of stream) partes.push(c);
  return Buffer.concat(partes).toString();
}

test('cifrarArquivoEmFluxo gera o MESMO formato do encryptBuffer (decryptBuffer abre)', async () => {
  const dir = pasta();
  try {
    writeFileSync(path.join(dir, 'd.sql'), DUMP);
    const bytes = await cifrarArquivoEmFluxo(path.join(dir, 'd.sql'), path.join(dir, 'd.enc'));
    const enc = readFileSync(path.join(dir, 'd.enc'));
    assert.equal(bytes, enc.length);
    assert.ok(isEncryptedBuffer(enc));
    assert.ok(!enc.toString('latin1').includes('031.918.597-48'), 'CPF não pode aparecer em claro');
    assert.equal(zlib.gunzipSync(decryptBuffer(enc)).toString(), DUMP);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('abrirBackupEmFluxo lê backup feito pelo encryptBuffer e backup antigo em claro', async () => {
  const dir = pasta();
  try {
    writeFileSync(path.join(dir, 'novo.enc'), encryptBuffer(zlib.gzipSync(DUMP)));
    writeFileSync(path.join(dir, 'antigo.gz'), zlib.gzipSync(DUMP));
    assert.equal(await lerTudo(abrirBackupEmFluxo(path.join(dir, 'novo.enc'))), DUMP);
    assert.equal(await lerTudo(abrirBackupEmFluxo(path.join(dir, 'antigo.gz'))), DUMP);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('abrirBackupEmFluxo acusa arquivo adulterado', async () => {
  const dir = pasta();
  try {
    const enc = encryptBuffer(zlib.gzipSync(DUMP));
    enc[enc.length - 1] ^= 0xff;
    writeFileSync(path.join(dir, 'x.enc'), enc);
    await assert.rejects(lerTudo(abrirBackupEmFluxo(path.join(dir, 'x.enc'))));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('verificarArquivoBackup aprova cópia completa e reprova cópia cortada', async () => {
  const dir = pasta();
  try {
    writeFileSync(path.join(dir, 'd.sql'), DUMP);
    const arq = path.join(dir, 'd.enc');
    await cifrarArquivoEmFluxo(path.join(dir, 'd.sql'), arq);
    const boa = await verificarArquivoBackup(arq);
    assert.equal(boa.ok, true, boa.message);
    assert.equal(boa.tabelas, TABELAS.length);

    truncateSync(arq, Math.floor(statSync(arq).size / 2));
    const cortada = await verificarArquivoBackup(arq);
    assert.equal(cortada.ok, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
