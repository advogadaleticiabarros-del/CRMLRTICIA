// tests/clientsBirthDateForm.test.mjs
// Ideia 3 de prioridade alta da auditoria do módulo Clientes (23/09/2026): a
// coluna clients.birth_date existe desde a migration 095 (usada pra
// aniversariantes no briefing matinal), mas o formulário de cadastro/edição
// de cliente nunca teve campo pra preencher — só ficava preenchida em fluxos
// específicos (ex.: conversão automática). Agora o campo existe no
// formulário e o backend aceita salvar/atualizar.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const routePath = path.resolve('src/routes/clients.ts');
const frontPath = path.resolve('public/app.js');
const routeSrc = fs.readFileSync(routePath, 'utf8');
const frontSrc = fs.readFileSync(frontPath, 'utf8');

test('SQL novo de clients.ts não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([routePath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});

test('POST /api/clients aceita e grava birth_date', () => {
  const idx = routeSrc.indexOf("router.post('/', async");
  const fim = routeSrc.indexOf('\n});', idx);
  const bloco = routeSrc.slice(idx, fim);
  assert.match(bloco, /birth_date/);
});

test('PUT /api/clients/:id aceita atualizar birth_date', () => {
  const idx = routeSrc.indexOf("router.put('/:id'");
  const fim = routeSrc.indexOf('\n});', idx);
  const bloco = routeSrc.slice(idx, fim);
  assert.match(bloco, /setIf\('birth_date'/);
});

test('clientForm (cadastro/edição) tem campo de data de nascimento', () => {
  const idx = frontSrc.indexOf('async function clientForm');
  const fim = frontSrc.indexOf('\n}', frontSrc.indexOf('openModal', idx));
  const bloco = frontSrc.slice(idx, fim);
  assert.match(bloco, /birth_date/);
  assert.match(bloco, /type:\s*'date'/);
});
