// Relato 02/10/2026: 3 acordos realizados e nenhum "puxado" pelo sistema —
// não havia regra que lesse homologação de acordo/transação nas movimentações.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'acd-'));
execSync(`npx tsc src/services/deteccaoAcordo.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const m = (await import(pathToFileURL(path.join(out, 'deteccaoAcordo.js')).href)).default;

test('homologação de acordo/transação → homologado', () => {
  for (const t of [
    'Homologação de Transação | 1º grau — Homologação de Transação',
    'Foi homologado acordo em execução ou cumprimento de sentença',
    'HOMOLOGO o acordo celebrado entre as partes para que surta seus efeitos',
    'Sentença homologatória de acordo',
    'Homologada a conciliação realizada em audiência',
  ]) assert.equal(m.detectarAcordo(t)?.tipo, 'homologado', t);
});

test('petição/termo de acordo juntado → proposto', () => {
  assert.equal(m.detectarAcordo('Em 21/08/2026, foi juntada petição de acordo ao processo')?.tipo, 'proposto');
  assert.equal(m.detectarAcordo('Juntada de termo de acordo')?.tipo, 'proposto');
  assert.equal(m.detectarAcordo('As partes informam que celebraram acordo')?.tipo, 'proposto');
});

test('não confunde com sentença de juiz leigo nem com acordo negado', () => {
  assert.equal(m.detectarAcordo('Homologação de Decisão de Juiz Leigo'), null);
  assert.equal(m.detectarAcordo('Audiência de conciliação: as partes não chegaram a acordo'), null);
  assert.equal(m.detectarAcordo('Conciliação infrutífera, sem acordo'), null);
  assert.equal(m.detectarAcordo('Intimação para manifestação'), null);
  assert.equal(m.detectarAcordo(''), null);
});

test('valor sugerido: maior R$ citado no texto', () => {
  const r = m.detectarAcordo('HOMOLOGO o acordo no valor total de R$ 12.500,00, sendo R$ 2.500,00 de entrada');
  assert.equal(r.valorSugerido, 12500);
  assert.equal(m.detectarAcordo('Homologação de Transação').valorSugerido, null);
});
