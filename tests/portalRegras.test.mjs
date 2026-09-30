// Portal como hub (diagnóstico ago/2026): upload pelo checklist e mensagens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-'));
execSync(`npx tsc src/services/portalRegras.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const m = (await import(pathToFileURL(path.join(out, 'portalRegras.js')).href)).default;

test('upload aceita PDF e fotos até 10MB', () => {
  assert.equal(m.validarArquivoPortal('application/pdf', 1000), null);
  assert.equal(m.validarArquivoPortal('image/jpeg', 1000), null);
  assert.equal(m.validarArquivoPortal('image/heic', 1000), null);
});

test('upload recusa tipo perigoso e arquivo grande', () => {
  assert.match(m.validarArquivoPortal('text/html', 10), /PDF ou foto/);
  assert.match(m.validarArquivoPortal('application/x-msdownload', 10), /PDF ou foto/);
  assert.match(m.validarArquivoPortal('application/pdf', 11 * 1024 * 1024), /10MB/);
  assert.match(m.validarArquivoPortal('application/pdf', 0), /vazio/);
});

test('nome do documento enviado identifica o item e a origem', () => {
  assert.equal(m.nomeDocumentoPortal('CTPS (digital ou física)', 'foto.jpg'), 'CTPS (digital ou física) — enviado pelo portal (foto.jpg)');
  assert.equal(m.nomeDocumentoPortal('RG ou CNH', ''), 'RG ou CNH — enviado pelo portal');
});

test('mensagem do portal: texto obrigatório, até 2000 caracteres, sem só espaços', () => {
  assert.equal(m.validarMensagem('Olá, doutora'), 'Olá, doutora');
  assert.equal(m.validarMensagem('   '), null);
  assert.equal(m.validarMensagem('x'.repeat(2500)).length, 2000);
});
