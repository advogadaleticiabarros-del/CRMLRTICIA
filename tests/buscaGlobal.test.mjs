// "Assistente de bolso" pedido pela Dra. Letícia (29/09/2026): de qualquer
// tela do celular, buscar cliente OU processo e já ver a última movimentação,
// sem navegar até a ficha. GET /api/busca?q=
//
// Corrigido em 29/09/2026 (achado real: busca lenta) — LIKE '%termo%' não usa
// índice; prioriza LIKE 'termo%' (prefixo) e só cai pro "contém" se faltar
// resultado. Última movimentação passou de 4 subconsultas correlacionadas
// (1 ida ao banco por linha) para 2 buscas em lote.
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

test('busca de cliente tenta prefixo (usa índice) antes do "contém"', () => {
  const i = src.indexOf('async function buscarClientes');
  const bloco = src.slice(i, src.indexOf('\n}', i));
  assert.match(bloco, /name LIKE \?.*ORDER BY name ASC LIMIT 8/s);
  assert.match(bloco, /porPrefixo\.length >= 5/);
  assert.match(bloco, /cpf_cnpj LIKE \?/);
});

test('busca de processo também prioriza prefixo, com fallback pro "contém"', () => {
  const i = src.indexOf('async function buscarCasos');
  const bloco = src.slice(i, src.indexOf('\n}', i));
  assert.match(bloco, /porPrefixo\.length >= 5/);
  assert.match(bloco, /c\.title LIKE \?/);
  assert.match(bloco, /c\.case_number LIKE \?/);
  assert.match(bloco, /cl\.name LIKE \?/);
});

test('última movimentação é buscada em lote (2 consultas), não 1 por processo', () => {
  const i = src.indexOf('async function anexarUltimaMovimentacao');
  const bloco = src.slice(i, src.indexOf('\nexport default', i));
  assert.match(bloco, /case_id IN \(\$\{placeholders\}\)/);
  assert.match(bloco, /FROM case_movements/);
  assert.match(bloco, /FROM legal_processes/);
  assert.match(bloco, /FROM process_movements|JOIN process_movements/);
  // escolhe a mais recente entre as duas fontes
  assert.match(bloco, /new Date\(r\.data\)\.getTime\(\) > new Date\(atual\.data\)\.getTime\(\)/);
});

test('lista vazia de processos não dispara nenhuma consulta de movimentação', () => {
  const i = src.indexOf('async function anexarUltimaMovimentacao');
  const bloco = src.slice(i, src.indexOf('\n}', i + 50));
  assert.match(bloco, /if \(!cases\.length\) return;/);
});

test('SQL não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([routePath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});
