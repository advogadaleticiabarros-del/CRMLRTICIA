// 13 processos duplicados (mesmo número com e sem máscara) — análise 02/10/2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'uniao-'));
execSync(`npx tsc src/services/unirProcessosRegras.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const m = (await import(pathToFileURL(path.join(out, 'unirProcessosRegras.js')).href)).default;

test('seguro: mesmo cliente / um lado vazio; mantém o mais antigo e herda cliente e caso', () => {
  const p = m.planoUniao([{ id: 130, client_id: 66, case_id: 6 }, { id: 140, client_id: 66, case_id: null }]);
  assert.deepEqual(p, { manter: 130, remover: [140], client_id: 66, case_id: 6, conflito: false, clientes: [66], casos: [6] });
  const q = m.planoUniao([{ id: 4, client_id: null, case_id: null }, { id: 9, client_id: 3, case_id: null }]);
  assert.equal(q.client_id, 3);
  assert.equal(q.conflito, false);
});

test('conflito: clientes ou casos diferentes — não decide sozinho', () => {
  const p = m.planoUniao([{ id: 137, client_id: 89, case_id: 40 }, { id: 139, client_id: 90, case_id: null }]);
  assert.equal(p.conflito, true);
  assert.deepEqual(p.clientes, [89, 90]);
  const q = m.planoUniao([{ id: 113, client_id: 67, case_id: 11 }, { id: 114, client_id: 67, case_id: 12 }]);
  assert.equal(q.conflito, true);
  assert.deepEqual(q.casos, [11, 12]);
});

test('escolha manual precisa ser um dos valores do grupo', () => {
  const g = [{ id: 1, client_id: 5, case_id: 2 }, { id: 2, client_id: 6, case_id: 3 }];
  assert.equal(m.escolhaValida(g, 6, 2), true);
  assert.equal(m.escolhaValida(g, 99, 2), false);
  assert.equal(m.escolhaValida(g, 5, null), true);
});
