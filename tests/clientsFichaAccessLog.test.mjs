// tests/clientsFichaAccessLog.test.mjs
// Ideia 1 de prioridade alta da auditoria do módulo Clientes (23/09/2026):
// GET /:id (tela simples) já registrava log de acesso LGPD, mas o frontend
// usa GET /:id/ficha (a ficha completa — CPF, endereço, financeiro,
// documentos) pra abrir o cliente de verdade, e essa rota nunca gerava
// nenhum registro. Passa a chamar logAccess() também, mesmo padrão
// best-effort já usado em GET /:id.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const routePath = path.resolve('src/routes/clients.ts');
const src = fs.readFileSync(routePath, 'utf8');

function rotaFicha() {
  const idx = src.indexOf("router.get('/:id/ficha'");
  assert.ok(idx > -1, "rota GET '/:id/ficha' não encontrada");
  const fim = src.indexOf("\nrouter.", idx + 10);
  return src.slice(idx, fim > -1 ? fim : undefined);
}

test('GET /:id/ficha registra log de acesso LGPD (a ficha completa é o dado mais sensível)', () => {
  const bloco = rotaFicha();
  assert.match(bloco, /logAccess/, 'rota deveria chamar logAccess()');
  assert.match(bloco, /action:\s*'ficha_cliente'/, "action deveria ser 'ficha_cliente', igual à rota simples");
});

test('log de acesso na ficha é best-effort (tem .catch, não trava a resposta)', () => {
  const bloco = rotaFicha();
  const trecho = bloco.slice(bloco.indexOf('logAccess') - 100, bloco.indexOf('logAccess') + 300);
  assert.match(trecho, /\.catch\(/, 'chamada a logAccess deveria ser best-effort, com .catch()');
});

test('SQL novo de clients.ts não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([routePath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});
