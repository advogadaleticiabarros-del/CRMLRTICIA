// tests/whatsappChatsQuery.test.mjs
// Audita a query de GET /chats contra o schema real — mesmo mecanismo já usado
// no Briefing Jurídico Matinal (tests/briefingDataBlocks.test.mjs), para não
// reintroduzir coluna/tabela inexistente nas subqueries novas de
// proxima_audiencia_dias/parcela_vencendo_dias.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

test('GET /chats: subqueries novas não referenciam tabela/coluna inexistente', () => {
  const arquivo = path.resolve('src/routes/whatsapp-instance.ts');
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([arquivo]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});

test('GET /chats: SELECT inclui proxima_audiencia_dias e parcela_vencendo_dias', () => {
  const src = fs.readFileSync(path.resolve('src/routes/whatsapp-instance.ts'), 'utf8');
  const m = src.match(/router\.get\('\/chats'[\s\S]*?\}\);/);
  assert.ok(m, 'rota GET /chats não encontrada');
  assert.match(m[0], /proxima_audiencia_dias/);
  assert.match(m[0], /parcela_vencendo_dias/);
});
