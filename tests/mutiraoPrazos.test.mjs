// Mutirão de prazos detectados (análise 02/10/2026: 61 a confirmar, o mais
// antigo de 17/08): separar vencidos/urgentes/demais e achar duplicados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-'));
execSync(`npx tsc src/services/mutiraoPrazos.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const m = (await import(pathToFileURL(path.join(out, 'mutiraoPrazos.js')).href)).default;

test('classificação pelo vencimento calculado', () => {
  assert.equal(m.classificar('2026-09-30', '2026-10-02'), 'vencido');
  assert.equal(m.classificar('2026-10-02', '2026-10-02'), 'urgente');
  assert.equal(m.classificar('2026-10-07', '2026-10-02'), 'urgente');
  assert.equal(m.classificar('2026-10-08', '2026-10-02'), 'normal');
});

test('organiza: urgentes primeiro, depois demais, vencidos por último; duplicado marcado', () => {
  const r = m.organizar([
    { id: 1, process_number: '0000082-24.2026.5.17.0001', suggested_type: 'Recurso', vencimento: '2026-09-01' },
    { id: 2, process_number: '00000822420265170001', suggested_type: 'Recurso', vencimento: '2026-09-01' },
    { id: 3, process_number: '111', suggested_type: 'Contestação', vencimento: '2026-10-20' },
    { id: 4, process_number: '222', suggested_type: 'Manifestação', vencimento: '2026-10-03' },
  ], '2026-10-02');
  assert.deepEqual(r.map((x) => x.id), [4, 3, 1, 2]);
  assert.equal(r.find((x) => x.id === 2).duplicado_de, 1);
  assert.equal(r.find((x) => x.id === 1).duplicado_de, null);
  assert.equal(r.find((x) => x.id === 4).grupo, 'urgente');
});
