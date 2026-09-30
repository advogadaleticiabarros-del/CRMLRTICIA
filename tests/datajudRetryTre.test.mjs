// Diagnóstico ago/2026: consulta por número não tentava de novo quando o CNJ
// falhava por instabilidade (5xx/timeout), e TRE-ES/TRE-PR não estavam na
// lista de tribunais monitorados.
import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'datajud-retry-'));
execSync(`npx tsc src/services/datajud.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
process.env.DATAJUD_API_KEY = 'chave-de-teste';
process.env.DATAJUD_RETRY_DELAY_MS = '1';
const mod = (await import(pathToFileURL(path.join(out, 'datajud.js')).href)).default;
const { consultarProcessoDataJud, TRIBUNAIS } = mod;

const original = globalThis.fetch;
test.after(() => { globalThis.fetch = original; });
const ok = { ok: true, status: 200, json: async () => ({ hits: { hits: [{ _source: { movimentos: [{ nome: 'Juntada', dataHora: '2026-09-01' }] } }] } }) };

test('5xx transitório: tenta de novo e devolve o resultado', async () => {
  let n = 0;
  globalThis.fetch = async () => (++n < 3 ? { ok: false, status: 503 } : ok);
  const r = await consultarProcessoDataJud('0001234-56.2024.8.08.0001');
  assert.equal(r.found, true);
  assert.equal(n, 3);
});

test('timeout/exceção de rede também é tentado de novo', async () => {
  let n = 0;
  globalThis.fetch = async () => { if (++n === 1) { const e = new Error('x'); e.name = 'AbortError'; throw e; } return ok; };
  const r = await consultarProcessoDataJud('0001234-56.2024.8.08.0001');
  assert.equal(r.found, true);
  assert.equal(n, 2);
});

test('4xx não é tentado de novo', async () => {
  let n = 0;
  globalThis.fetch = async () => { n++; return { ok: false, status: 401 }; };
  const r = await consultarProcessoDataJud('0001234-56.2024.8.08.0001');
  assert.equal(r.found, false);
  assert.equal(n, 1);
});

test('desiste após 3 tentativas', async () => {
  let n = 0;
  globalThis.fetch = async () => { n++; return { ok: false, status: 502 }; };
  const r = await consultarProcessoDataJud('0001234-56.2024.8.08.0001');
  assert.equal(r.found, false);
  assert.match(r.error, /502/);
  assert.equal(n, 3);
});

test('TRE-ES e TRE-PR monitorados', () => {
  assert.equal(TRIBUNAIS.api_publica_trees.sigla, 'TRE-ES');
  assert.equal(TRIBUNAIS.api_publica_trepr.sigla, 'TRE-PR');
});
