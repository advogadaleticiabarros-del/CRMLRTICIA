// tests/emailChegada.test.mjs — fila "Importados do e-mail" mostra quando o e-mail CHEGOU
// (pedido da Jessica, 23/10/2026), não só quando o CRM importou.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

test('SQL da data de chegada não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([
    'src/routes/emailIntake.ts', 'src/services/emailIntake.ts', 'src/services/partnerInboxService.ts',
  ]);
  assert.deepStrictEqual(tabelasInexistentes, []);
  assert.deepStrictEqual(colunasInexistentes, []);
});

test('importação do Gmail grava a data de chegada (internalDate) nos dois caminhos', () => {
  const src = fs.readFileSync('src/services/partnerInboxService.ts', 'utf8');
  assert.strictEqual((src.match(/receivedAt: dataDeChegada\(full\.data\.internalDate\)/g) || []).length, 2);
  assert.match(fs.readFileSync('src/services/emailIntake.ts', 'utf8'), /received_at\)/);
});

test('a fila mostra a coluna "Chegou em" e cai na data da importação quando não há data do Gmail', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  const i = app.indexOf('Importados do e-mail — aguardando revisão');
  const bloco = app.slice(i, i + 3000);
  assert.match(bloco, /<th>Chegou em<\/th>/);
  assert.match(bloco, /r\.received_at \|\| r\.created_at/);
  assert.match(bloco, /importado em/);
});
