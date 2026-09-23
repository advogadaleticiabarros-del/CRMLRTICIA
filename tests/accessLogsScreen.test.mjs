// tests/accessLogsScreen.test.mjs
// Achado da pesquisa de módulos ainda não auditados (22/09/2026): access_logs
// (log de acesso a ficha de cliente/processo, LGPD) era gravado desde a
// migration 059 mas não tinha endpoint nem tela — só SQL direto. Adicionados
// GET /api/access-logs (+/stats) e o card em Configurações. Testes estáticos
// (auditam o código-fonte) + o schemaAudit de sempre pra SQL novo.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const routePath = path.resolve('src/routes/accessLogs.ts');
const appPath = path.resolve('src/app.ts');
const frontendPath = path.resolve('public/app.js');
const routeSrc = fs.readFileSync(routePath, 'utf8');
const appSrc = fs.readFileSync(appPath, 'utf8');
const frontendSrc = fs.readFileSync(frontendPath, 'utf8');

test('SQL novo de access-logs não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([routePath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});

test('rota /api/access-logs é montada com requireAdmin (dado sensível — quem acessou o quê)', () => {
  const linha = appSrc.match(/app\.use\('\/api\/access-logs'[^;]*;/);
  assert.ok(linha, "app.use('/api/access-logs', ...) não encontrado em app.ts");
  assert.match(linha[0], /requireAdmin/);
});

test('GET /api/access-logs aceita filtro por nome de cliente (client_name) via JOIN', () => {
  assert.match(routeSrc, /client_name/);
  assert.match(routeSrc, /LEFT JOIN clients cl ON cl\.id = al\.client_id/);
});

test('a contagem total usa o mesmo JOIN do filtro (senão client_name quebraria a paginação)', () => {
  const countStmt = routeSrc.match(/SELECT COUNT\(\*\) AS total FROM access_logs[^`]*/);
  assert.ok(countStmt, 'query de contagem não encontrada');
  assert.match(countStmt[0], /LEFT JOIN clients cl/);
});

test('Configurações ganha o card de log de acesso, chamando /api/access-logs/stats', () => {
  assert.match(frontendSrc, /Log de acesso a dados pessoais \(LGPD\)/);
  assert.match(frontendSrc, /api\('\/api\/access-logs\/stats'\)/);
});
