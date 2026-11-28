// Vigia da ponte do TJES (28/11/2026). Em 27/11 o computador do escritório ficou
// desligado o dia todo e nenhuma rodada do TJES rodou, sem ninguém saber.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vigia-'));
execSync(`npx tsc src/services/mni/vigiaPonte.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const v = (await import(pathToFileURL(path.join(out, 'vigiaPonte.js')).href)).default;

const MSG = 'O computador do escritório não está conectado (a consulta ao tribunal passa por ele...)';
const base = {
  ultimoOkEm: new Date('2026-11-26T22:14:00Z'),
  ultimoErro: MSG,
  ultimoErroEm: new Date('2026-11-27T10:10:00Z'),
  avisoEm: null,
  ponteConectada: false,
};

test('falhou pela ponte e ela continua desligada: avisa uma vez', () => {
  assert.equal(v.decidirVigiaPonte(base), 'avisar');
  assert.equal(v.decidirVigiaPonte({ ...base, avisoEm: new Date('2026-11-27T10:20:00Z') }), 'nada', 'já avisou desta queda');
});

test('aviso de uma queda anterior não vale para a nova', () => {
  assert.equal(v.decidirVigiaPonte({ ...base, avisoEm: new Date('2026-11-20T10:20:00Z') }), 'avisar');
});

test('falhou pela ponte e ela voltou: roda a recuperação', () => {
  assert.equal(v.decidirVigiaPonte({ ...base, ponteConectada: true }), 'recuperar');
  assert.equal(v.decidirVigiaPonte({ ...base, ponteConectada: true, avisoEm: new Date('2026-11-27T10:20:00Z') }), 'recuperar');
});

test('última rodada deu certo, ou o erro não é da ponte: nada', () => {
  assert.equal(v.decidirVigiaPonte({ ...base, ultimoOkEm: new Date('2026-11-27T11:00:00Z') }), 'nada');
  assert.equal(v.decidirVigiaPonte({ ...base, ultimoErro: 'Tribunal fora do ar (HTTP 503).' }), 'nada');
  assert.equal(v.decidirVigiaPonte({ ...base, ultimoErro: null, ultimoErroEm: null }), 'nada');
  assert.equal(v.decidirVigiaPonte(null), 'nada', 'sem login do TJES cadastrado');
});

function depsFake(estado, { recuperarOk = true } = {}) {
  const feito = { avisos: [], recuperou: 0, marcouAviso: 0 };
  return {
    feito,
    deps: {
      async estado() { return estado; },
      async recuperar() { feito.recuperou++; return recuperarOk; },
      async avisar(t) { feito.avisos.push(t); },
      async marcarAviso() { feito.marcouAviso++; },
    },
  };
}

test('vigiar: avisa a equipe e marca o aviso', async () => {
  const { deps, feito } = depsFake(base);
  const r = await v.vigiarPonteTjes(deps);
  assert.equal(r.acao, 'avisar');
  assert.equal(feito.avisos.length, 1);
  assert.match(feito.avisos[0], /computador do escritório/);
  assert.match(feito.avisos[0], /TJES/);
  assert.equal(feito.marcouAviso, 1);
});

test('vigiar: ponte voltou depois do aviso, recupera e avisa que voltou', async () => {
  const { deps, feito } = depsFake({ ...base, ponteConectada: true, avisoEm: new Date('2026-11-27T10:20:00Z') });
  const r = await v.vigiarPonteTjes(deps);
  assert.equal(r.acao, 'recuperar');
  assert.equal(feito.recuperou, 1);
  assert.equal(feito.avisos.length, 1);
  assert.match(feito.avisos[0], /voltou|lido de novo/i);
});

test('vigiar: recuperação sem aviso anterior não manda mensagem', async () => {
  const { deps, feito } = depsFake({ ...base, ponteConectada: true });
  await v.vigiarPonteTjes(deps);
  assert.equal(feito.recuperou, 1);
  assert.equal(feito.avisos.length, 0);
});
