// IA proativa (diagnóstico ago/2026): varredura diária da carteira — caso
// parado e prescrição se aproximando. Só alerta; nunca decide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vigia-'));
execSync(`npx tsc src/services/carteiraVigia.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const m = (await import(pathToFileURL(path.join(out, 'carteiraVigia.js')).href)).default;

const hoje = '2026-09-30';

test('processo parado: marco 30 e 60 dias, nada abaixo de 30', () => {
  assert.equal(m.marcoParado('2026-09-10', hoje), null);
  assert.equal(m.marcoParado('2026-08-25', hoje), 30);
  assert.equal(m.marcoParado('2026-07-01', hoje), 60);
  assert.equal(m.marcoParado(null, hoje), null); // sem movimentação registrada: não chuta
});

test('prescrição: devolve o menor marco já alcançado (90/60/30/15/7) e vencida', () => {
  assert.equal(m.marcoPrescricao('2027-06-01', hoje), null);
  assert.equal(m.marcoPrescricao('2026-12-20', hoje), 90);
  assert.equal(m.marcoPrescricao('2026-10-25', hoje), 30);
  assert.equal(m.marcoPrescricao('2026-10-05', hoje), 7);
  assert.equal(m.marcoPrescricao('2026-09-29', hoje), 0);
});

test('sugestão por área é só sugestão, com base legal', () => {
  const t = m.sugerirPrescricao('trabalhista', '2025-03-10');
  assert.equal(t.data, '2027-03-10');
  assert.match(t.base, /7º, XXIX/);
  assert.equal(m.sugerirPrescricao('consumidor', '2024-01-15').data, '2029-01-15');
  assert.equal(m.sugerirPrescricao('civel', '2024-01-15').data, '2027-01-15');
  assert.equal(m.sugerirPrescricao('previdenciario', '2024-01-15'), null); // fundo de direito não prescreve
  assert.equal(m.sugerirPrescricao('trabalhista', null), null);
});

test('texto do alerta', () => {
  assert.match(m.textoPrescricao({ clientName: 'Ana', title: 'Rescisão', data: '2026-10-05' }, 7), /7 dias.*Ana/);
  assert.match(m.textoPrescricao({ clientName: 'Ana', title: 'Rescisão', data: '2026-09-29' }, 0), /passou/i);
  assert.match(m.textoParado({ processNumber: '0001', clientName: 'Ana' }, 60), /60 dias/);
});
