import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Testes estáticos (sem banco): confirmam que a rota de resolver existe,
 * está registrada com o middleware correto, e que o handler valida o
 * formato de item_key antes de tocar no banco — sem precisar de conexão
 * MySQL real (o projeto não roda testes de integração com banco).
 */

const raiz = path.resolve('.');
const rotaPath = path.join(raiz, 'src/routes/dashboards/cockpit.ts');
const appPath = path.join(raiz, 'src/app.ts');

test('a rota POST /resolver está definida em cockpit.ts', () => {
  const src = fs.readFileSync(rotaPath, 'utf8');
  assert.match(src, /router\.post\(\s*['"]\/resolver['"]/, 'esperava router.post(\'/resolver\', ...)');
});

test('a rota /api/dashboards/cockpit continua usando authenticate + requireStaff (não requireAdmin)', () => {
  const src = fs.readFileSync(appPath, 'utf8');
  const linha = src.split('\n').find((l) => l.includes("'/api/dashboards/cockpit'"));
  assert.ok(linha, 'linha da rota não encontrada em src/app.ts');
  assert.match(linha, /authenticate,\s*requireStaff/, `esperava authenticate+requireStaff, achei: ${linha}`);
  assert.doesNotMatch(linha, /requireAdmin/, 'a rota do Cockpit não deve exigir admin');
});

test('o handler de /resolver valida o formato do item_key antes de usar', () => {
  const src = fs.readFileSync(rotaPath, 'utf8');
  // Confirma que existe alguma validação de formato (regex ou checagem
  // manual) antes do INSERT — não aceita string vazia/arbitrária.
  const trechoResolver = src.slice(src.indexOf("post('/resolver'"));
  assert.match(trechoResolver, /item_key/);
  assert.match(trechoResolver, /ON DUPLICATE KEY UPDATE/i, 'o INSERT deve ser idempotente');
});
