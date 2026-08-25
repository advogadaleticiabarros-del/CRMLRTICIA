import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('propostas.ts define LEGAL_AREAS com as mesmas 7 opções de cases.legal_area', () => {
  const src = fs.readFileSync(path.resolve('src/routes/propostas.ts'), 'utf8');
  const m = src.match(/const LEGAL_AREAS\s*=\s*\[[^\]]+\]/);
  assert.ok(m, 'LEGAL_AREAS não encontrada em propostas.ts');
  for (const area of ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro']) {
    assert.match(m[0], new RegExp(`'${area}'`), `área "${area}" ausente de LEGAL_AREAS`);
  }
});

test('POST /api/propostas valida legal_area contra LEGAL_AREAS antes do INSERT', () => {
  const src = fs.readFileSync(path.resolve('src/routes/propostas.ts'), 'utf8');
  const m = src.match(/router\.post\('\/', async[\s\S]*?\nrouter\./);
  assert.ok(m, 'rota POST / não encontrada');
  assert.match(m[0], /LEGAL_AREAS\.includes\(legal_area\)/, 'POST precisa validar legal_area contra LEGAL_AREAS antes de gravar');
});

test('PUT /api/propostas/:id valida legal_area contra LEGAL_AREAS via setIf', () => {
  const src = fs.readFileSync(path.resolve('src/routes/propostas.ts'), 'utf8');
  const m = src.match(/router\.put\('\/:id'[\s\S]*?setIf\('legal_area'[^)]*\)/);
  assert.ok(m, "setIf('legal_area', ...) não encontrado na rota PUT /:id");
  assert.match(m[0], /LEGAL_AREAS\.includes\(req\.body\.legal_area\)/, "setIf('legal_area', ...) precisa validar contra LEGAL_AREAS");
});
