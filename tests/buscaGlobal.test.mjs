// "Assistente de bolso" pedido pela Dra. Letícia (29/09/2026): de qualquer
// tela do celular, buscar cliente OU processo e já ver a última movimentação,
// sem navegar até a ficha. GET /api/busca?q=
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const routePath = path.resolve('src/routes/busca.ts');
const src = fs.readFileSync(routePath, 'utf8');
const appSrc = fs.readFileSync(path.resolve('src/app.ts'), 'utf8');

test('rota está registrada e autenticada em app.ts', () => {
  assert.match(appSrc, /app\.use\('\/api\/busca',\s*authenticate,\s*requireStaff,\s*buscaRoutes\)/);
});

test('busca curta (menos de 2 chars) devolve vazio sem consultar o banco', () => {
  const idx = src.indexOf("router.get('/'");
  const bloco = src.slice(idx, src.indexOf('\n});', idx));
  assert.match(bloco, /q\.length < 2/);
  assert.match(bloco, /res\.json\(\{ clients: \[\], cases: \[\] \}\)/);
});

test('busca clientes por nome, telefone e CPF/CNPJ (quando parecer número)', () => {
  assert.match(src, /FROM clients/);
  assert.match(src, /name LIKE \?/);
  assert.match(src, /phone LIKE \?/);
  assert.match(src, /cpf_cnpj LIKE \?/);
});

test('busca processos por título, número e nome do cliente', () => {
  assert.match(src, /FROM cases c/);
  assert.match(src, /c\.title LIKE \?/);
  assert.match(src, /c\.case_number LIKE \?/);
  assert.match(src, /cl\.name LIKE \?/);
});

test('traz a última movimentação, escolhendo a mais recente entre interna e do monitoramento', () => {
  assert.match(src, /case_movements/);
  assert.match(src, /process_movements/);
  assert.match(src, /ultima_movimentacao/);
  assert.match(src, /dataMonitor > dataInterna/);
});

test('SQL não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([routePath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});
