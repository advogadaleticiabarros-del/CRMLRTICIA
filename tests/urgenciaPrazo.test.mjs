// Escalonamento de urgência de prazo (ideias 2, 4 e 5 da auditoria de
// Processos e prazos, 28/09/2026). Função pura — testada isolada: strip de
// `export` e anotações de tipo primitivas, avaliada com new Function.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve('src/utils/urgenciaPrazo.ts'), 'utf8');
const js = src
  .replace(/export /g, '')
  .replace(/:\s*(string|number|boolean|null|undefined)(\s*\|\s*(string|number|boolean|null|undefined))*/g, '');
const escopo = {};
new Function('escopo', js + '\nescopo.nivelUrgencia = nivelUrgencia; escopo.diasAte = diasAte;')(escopo);
const { nivelUrgencia, diasAte } = escopo;

test('nível de urgência por dias restantes', () => {
  assert.equal(nivelUrgencia(-1), 'vencido');
  assert.equal(nivelUrgencia(0), 'critico');
  assert.equal(nivelUrgencia(1), 'critico');
  assert.equal(nivelUrgencia(2), 'alto');
  assert.equal(nivelUrgencia(3), 'alto');
  assert.equal(nivelUrgencia(4), 'atencao');
  assert.equal(nivelUrgencia(7), 'atencao');
  assert.equal(nivelUrgencia(8), 'normal');
  assert.equal(nivelUrgencia(30), 'normal');
});

test('diasAte conta dias de calendário entre hoje e o vencimento (sem fuso)', () => {
  assert.equal(diasAte('2026-10-05', '2026-10-01'), 4);
  assert.equal(diasAte('2026-10-01', '2026-10-01'), 0);
  assert.equal(diasAte('2026-09-30', '2026-10-01'), -1);
});
