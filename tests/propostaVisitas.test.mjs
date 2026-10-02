// Monitoramento do link da proposta (pedido 01/10/2026): tempo dentro da
// proposta, quantas vezes reabriu, até onde leu, dispositivo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pvis-'));
execSync(`npx tsc src/services/propostaVisitas.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const m = (await import(pathToFileURL(path.join(out, 'propostaVisitas.js')).href)).default;

test('incremento do sinal é limitado (nada de inflar tempo)', () => {
  assert.equal(m.segundosDoSinal(15), 15);
  assert.equal(m.segundosDoSinal(500), 30);
  assert.equal(m.segundosDoSinal(-3), 0);
  assert.equal(m.segundosDoSinal('abc'), 0);
});

test('scroll entre 0 e 100', () => {
  assert.equal(m.scrollValido(57.4), 57);
  assert.equal(m.scrollValido(130), 100);
  assert.equal(m.scrollValido(null), 0);
});

test('dispositivo pelo user-agent', () => {
  assert.equal(m.dispositivo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'celular');
  assert.equal(m.dispositivo('Mozilla/5.0 (Linux; Android 14; SM-A145M) Mobile'), 'celular');
  assert.equal(m.dispositivo('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'computador');
  assert.equal(m.dispositivo('Mozilla/5.0 (iPad; CPU OS 17_0)'), 'tablet');
});

test('resumo das visitas', () => {
  const r = m.resumoVisitas([
    { iniciada_em: '2026-10-01T10:00:00Z', segundos: 95, scroll_max: 40, dispositivo: 'celular' },
    { iniciada_em: '2026-10-02T09:00:00Z', segundos: 240, scroll_max: 100, dispositivo: 'celular' },
    { iniciada_em: '2026-10-02T12:00:00Z', segundos: 30, scroll_max: 100, dispositivo: 'computador' },
  ]);
  assert.equal(r.aberturas, 3);
  assert.equal(r.reaberturas, 2);
  assert.equal(r.tempoTotalSeg, 365);
  assert.equal(r.maiorSessaoSeg, 240);
  assert.equal(r.leuAteOFim, true);
  assert.equal(r.primeira, '2026-10-01T10:00:00Z');
  assert.equal(r.ultima, '2026-10-02T12:00:00Z');
  assert.deepEqual(r.dispositivos, ['celular', 'computador']);
});

test('sem visitas', () => {
  const r = m.resumoVisitas([]);
  assert.equal(r.aberturas, 0);
  assert.equal(r.primeira, null);
});

test('duração legível', () => {
  assert.equal(m.duracao(0), '0s');
  assert.equal(m.duracao(45), '45s');
  assert.equal(m.duracao(365), '6min 5s');
  assert.equal(m.duracao(3720), '1h 2min');
});
