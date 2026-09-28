// Ideia 9 (baixa) da auditoria de Processos e prazos (28/09/2026): erro de
// rede/servidor num tribunal virava "0 processos encontrados" na busca
// nacional por OAB. Agora fica registrado em `falhas` (404 = tribunal sem
// índice continua sendo ignorado, não é falha).
import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'datajud-'));
execSync(`npx tsc src/services/datajud.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
process.env.DATAJUD_API_KEY = 'chave-de-teste';
const { searchByOAB } = (await import(pathToFileURL(path.join(out, 'datajud.js')).href)).default;

const hit = { _source: { numeroProcesso: '00012345620248080001', movimentos: [] } };
const original = globalThis.fetch;
test.after(() => { globalThis.fetch = original; });

test('falha de um tribunal (500, timeout, exceção) é reportada; 404 é ignorado; sucesso segue valendo', async () => {
  globalThis.fetch = async (url) => {
    const slug = String(url).match(/api_publica_([a-z0-9]+)\//)[1];
    if (slug === 'tjes') return { ok: true, status: 200, json: async () => ({ hits: { hits: [hit] } }) };
    if (slug === 'tjsp') return { ok: false, status: 500 };
    if (slug === 'tjrj') throw new Error('socket hang up');
    if (slug === 'tjmg') { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    return { ok: false, status: 404 };
  };
  const r = await searchByOAB('12345', 'ES', 'national');
  assert.equal(r.total, 1);
  const falhou = Object.fromEntries(r.falhas.map((f) => [f.tribunal, f.erro]));
  assert.match(falhou.tjsp, /HTTP 500/);
  assert.match(falhou.tjrj, /socket hang up/);
  assert.match(falhou.tjmg, /tempo|timeout|aborted/i);
  assert.equal(falhou.tjes, undefined);
  assert.equal(falhou.tjac, undefined); // 404 não é falha
  assert.equal(r.falhas.length, 3);
});

test('sem falhas, falhas vem vazio', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  const r = await searchByOAB('12345', 'ES', 'state');
  assert.deepEqual(r.falhas, []);
  assert.equal(r.total, 0);
});

test('chave do DataJud ausente é reportada como falha, não como "0 processos"', async () => {
  const chave = process.env.DATAJUD_API_KEY;
  delete process.env.DATAJUD_API_KEY;
  globalThis.fetch = async () => { throw new Error('não deveria chamar'); };
  const r = await searchByOAB('12345', 'ES', 'state');
  process.env.DATAJUD_API_KEY = chave;
  assert.equal(r.falhas.length, 1);
  assert.match(r.falhas[0].erro, /DATAJUD_API_KEY/);
});
