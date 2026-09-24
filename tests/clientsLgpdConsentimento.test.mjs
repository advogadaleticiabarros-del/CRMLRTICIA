// tests/clientsLgpdConsentimento.test.mjs
// Ideia 10 (última de prioridade média) da auditoria do módulo Clientes
// (23/09/2026): só existia opt-in de newsletter pra lead — nada formalizava
// o consentimento de tratamento de dado do cliente em si. Migration 134
// adiciona clients.lgpd_consent_at; POST/PUT gravam a data quando marcado
// (nunca sobrescreve uma data já existente, só registra a 1ª vez) e limpam
// (revogam) quando desmarcado; formulário ganha o checkbox.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos, lerSchema } from './helpers/schemaAudit.mjs';

const routePath = path.resolve('src/routes/clients.ts');
const frontPath = path.resolve('public/app.js');
const routeSrc = fs.readFileSync(routePath, 'utf8');
const frontSrc = fs.readFileSync(frontPath, 'utf8');

test('migration 134 existe e adiciona clients.lgpd_consent_at', () => {
  const schema = lerSchema();
  assert.ok(schema.get('clients')?.has('lgpd_consent_at'), 'coluna lgpd_consent_at não encontrada no schema (migrations)');
});

test('POST /api/clients aceita lgpd_consent e grava a data', () => {
  const idx = routeSrc.indexOf("router.post('/', async");
  const fim = routeSrc.indexOf('\n});', idx);
  const bloco = routeSrc.slice(idx, fim);
  assert.match(bloco, /lgpd_consent/);
  assert.match(bloco, /lgpd_consent_at/);
});

test('PUT /api/clients/:id nunca sobrescreve um consentimento já registrado (COALESCE), mas permite revogar (NULL)', () => {
  const idx = routeSrc.indexOf("router.put('/:id'");
  const fim = routeSrc.indexOf('\n});', idx);
  const bloco = routeSrc.slice(idx, fim);
  assert.match(bloco, /lgpd_consent/);
  assert.match(bloco, /COALESCE\(lgpd_consent_at,\s*NOW\(\)\)/);
  assert.match(bloco, /lgpd_consent_at\s*=\s*NULL/);
});

test('SQL de clients.ts não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([routePath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});

test('clientForm tem o checkbox de consentimento LGPD', () => {
  const idx = frontSrc.indexOf('async function clientForm');
  const fim = frontSrc.indexOf('\n}', frontSrc.indexOf('openModal', idx));
  const bloco = frontSrc.slice(idx, fim);
  assert.match(bloco, /lgpd_consent/);
  assert.match(bloco, /checkbox/i);
});
