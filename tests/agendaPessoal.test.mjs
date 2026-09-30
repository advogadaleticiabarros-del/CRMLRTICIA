// Diagnóstico ago/2026 — agenda pessoal, recado e medicamento no mesmo sistema,
// com repetição diária (remédio às 8h todo dia) e aviso por WhatsApp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-pessoal-'));
execSync(`npx tsc src/services/agendaPessoal.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const m = (await import(pathToFileURL(path.join(out, 'agendaPessoal.js')).href)).default;

const serie = { start_datetime: '2026-09-30T11:00:00Z', end_datetime: '2026-09-30T11:15:00Z', repeat_until: '2026-10-05' };

test('ocorrência do dia seguinte mantém o mesmo horário', () => {
  const o = m.ocorrenciaNoDia(serie, '2026-10-01');
  assert.equal(o.start.toISOString(), '2026-10-01T11:00:00.000Z');
  assert.equal(o.end.toISOString(), '2026-10-01T11:15:00.000Z');
});

test('não gera no próprio dia da série nem antes', () => {
  assert.equal(m.ocorrenciaNoDia(serie, '2026-09-30'), null);
  assert.equal(m.ocorrenciaNoDia(serie, '2026-09-20'), null);
});

test('respeita a data final; sem data final repete indefinidamente', () => {
  assert.notEqual(m.ocorrenciaNoDia(serie, '2026-10-05'), null);
  assert.equal(m.ocorrenciaNoDia(serie, '2026-10-06'), null);
  assert.notEqual(m.ocorrenciaNoDia({ ...serie, repeat_until: null }, '2027-03-01'), null);
});

test('tipos pessoais reconhecidos', () => {
  assert.equal(m.ehTipoPessoal('medicamento'), true);
  assert.equal(m.ehTipoPessoal('recado'), true);
  assert.equal(m.ehTipoPessoal('pessoal'), true);
  assert.equal(m.ehTipoPessoal('audiencia'), false);
});

test('texto do lembrete por tipo, com horário de Brasília', () => {
  const t = m.textoLembrete({ event_type: 'medicamento', title: 'Losartana', start_datetime: '2026-10-01T11:00:00Z', description: '1 comprimido' });
  assert.match(t, /💊/);
  assert.match(t, /Losartana/);
  assert.match(t, /08:00/);
  assert.match(t, /1 comprimido/);
  assert.match(m.textoLembrete({ event_type: 'recado', title: 'Ligar pro contador', start_datetime: '2026-10-01T11:00:00Z' }), /📌.*Ligar pro contador/);
});
