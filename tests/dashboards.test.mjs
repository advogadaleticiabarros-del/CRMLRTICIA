import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lerSchema, tabelasComEscrita, auditarArquivos } from './helpers/schemaAudit.mjs';

/**
 * AUDITORIA DOS DASHBOARDS — contra o schema REAL.
 *
 * Três bugs reais motivaram este teste, e os três "pareciam funcionar":
 *   1. Processos  → `WHERE user_id = ?` numa tabela SEM essa coluna → erro 500
 *   2. Produção   → media `legal_pieces`, tabela onde NADA é inserido → zero eterno
 *   3. Rotinas    → a tabela `job_runs` nem existia (migrations paradas)
 *
 * Mostrar zero passa por "ainda não tem dado". Por isso ninguém reclama — e o
 * painel mente por meses. Este teste cruza cada query com o schema de verdade.
 *
 * O mecanismo de auditoria (ler schema das migrations, achar tabelas mortas,
 * cruzar alias.coluna de cada query) mora em tests/helpers/schemaAudit.mjs e é
 * reaproveitado por tests/briefingDataBlocks.test.mjs para auditar
 * src/services/morningBriefingService.ts.
 */

const raiz = path.resolve('.');
const dashDir = path.join(raiz, 'src/routes/dashboards');

const SCHEMA = lerSchema();
const ESCRITAS = tabelasComEscrita();
const DASHBOARDS = fs.readdirSync(dashDir).filter((f) => f.endsWith('.ts'));
const DASHBOARD_PATHS = DASHBOARDS.map((f) => path.join(dashDir, f));

test('a auditoria conseguiu ler o schema real', () => {
  assert.ok(SCHEMA.size > 30, `esperava dezenas de tabelas, achei ${SCHEMA.size}`);
  assert.ok(DASHBOARDS.length >= 5, `esperava vários dashboards, achei ${DASHBOARDS.length}`);
});

test('todo dashboard consulta apenas tabelas que EXISTEM no banco', () => {
  const { tabelasInexistentes } = auditarArquivos(DASHBOARD_PATHS, { schema: SCHEMA, escritas: ESCRITAS });
  assert.deepEqual(tabelasInexistentes, [], '\n  ' + tabelasInexistentes.join('\n  '));
});

test('nenhum dashboard mede uma tabela MORTA (onde o código nunca escreve)', () => {
  // Foi este o bug do dashboard de Produção: media `legal_pieces`, onde nada
  // é inserido → mostrava zero para sempre, com a esteira cheia.
  const { tabelasMortas } = auditarArquivos(DASHBOARD_PATHS, { schema: SCHEMA, escritas: ESCRITAS });
  assert.deepEqual(tabelasMortas, [], '\n  ' + tabelasMortas.join('\n  '));
});

test('nenhum dashboard filtra por uma coluna que NÃO existe na tabela', () => {
  // Foi este o bug do dashboard de Processos: `WHERE user_id = ?` em
  // legal_processes, que não tem essa coluna → erro 500.
  const { colunasInexistentes } = auditarArquivos(DASHBOARD_PATHS, { schema: SCHEMA, escritas: ESCRITAS });
  assert.deepEqual(colunasInexistentes, [], '\n  ' + colunasInexistentes.join('\n  '));
});
