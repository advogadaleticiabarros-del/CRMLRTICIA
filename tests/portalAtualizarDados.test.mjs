// tests/portalAtualizarDados.test.mjs
// Ideia 11 (prioridade baixa) da auditoria do módulo Clientes: expandir o
// autoatendimento do portal do cliente. Hoje o portal só CONSULTA (processos,
// financeiro, documentos) — pra mudar telefone/e-mail/endereço, o cliente
// precisa pedir pra Dra. Letícia fazer manualmente. Adiciona PUT /api/portal/me
// pra deixar o próprio cliente atualizar email/phone/address (campos sensíveis
// como nome, CPF e status continuam fora do alcance do cliente, só a
// advogada/equipe edita esses pelo cadastro normal).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const routePath = path.resolve('src/routes/portal.ts');
const frontPath = path.resolve('public/app.js');
const routeSrc = fs.readFileSync(routePath, 'utf8');
const frontSrc = fs.readFileSync(frontPath, 'utf8');

test('PUT /api/portal/me existe e só grava email/phone/address', () => {
  const idx = routeSrc.indexOf("router.put('/me'");
  assert.notEqual(idx, -1, 'rota PUT /me não encontrada em portal.ts');
  const fim = routeSrc.indexOf('\n});', idx);
  const bloco = routeSrc.slice(idx, fim);
  assert.match(bloco, /UPDATE clients/);
  assert.match(bloco, /email/);
  assert.match(bloco, /phone/);
  assert.match(bloco, /address/);
  // Campos sensíveis não devem ser alteráveis pelo cliente por esta rota
  assert.doesNotMatch(bloco, /cpf_cnpj\s*=/);
  assert.doesNotMatch(bloco, /\bstatus\s*=/);
});

test('rota usa loadClientId (só altera o próprio cliente logado, nunca por id arbitrário)', () => {
  const idx = routeSrc.indexOf("router.put('/me'");
  const fim = routeSrc.indexOf('\n});', idx);
  const bloco = routeSrc.slice(idx, fim);
  assert.match(bloco, /\(req as any\)\.clientId/);
});

test('SQL de portal.ts não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([routePath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});

test('tela do portal tem um jeito do cliente editar os próprios dados de contato', () => {
  const idx = frontSrc.indexOf('async portal(page)');
  assert.notEqual(idx, -1, 'função portal(page) não encontrada em app.js');
  const fim = frontSrc.indexOf('\n  },', frontSrc.indexOf('portal-tl', idx));
  const bloco = frontSrc.slice(idx, fim);
  assert.match(bloco, /portal\/me/);
});
