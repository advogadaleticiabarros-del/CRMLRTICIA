// Achado CRÍTICO da auditoria de Processos e prazos (28/09/2026): ao confirmar
// um prazo detectado, a data era calculada por um addBusinessDays local que só
// pulava sábado/domingo — ignorava feriado nacional/forense e a suspensão de
// 20/12 a 20/01. Perto de feriado, dava data MENOR que a real (risco de
// perder prazo). Agora usa o mesmo contarPrazo da calculadora manual.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const routePath = path.resolve('src/routes/detected-deadlines.ts');
const src = fs.readFileSync(routePath, 'utf8');

test('confirmação de prazo detectado usa contarPrazo (com feriados), não cálculo só de fim de semana', () => {
  assert.match(src, /contarPrazo/);
  assert.doesNotMatch(src, /function addBusinessDays/);
  assert.doesNotMatch(src, /addBusinessDays\(/);
});

test('o cálculo antigo divergia perto de feriado: 3 dias úteis a partir de 01/04/2026 (Quinta e Sexta Santa)', async () => {
  if (!fs.existsSync(path.resolve('dist/utils/prazoUtil.js'))) execSync('npx tsc', { stdio: 'ignore' });
  const { contarPrazo } = await import('../dist/utils/prazoUtil.js');
  const antigo = (startStr, n) => {
    const d = new Date(startStr + 'T00:00:00'); let added = 0;
    while (added < n) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) added++; }
    return d.toISOString().split('T')[0];
  };
  assert.equal(antigo('2026-04-01', 3), '2026-04-06');
  assert.equal(contarPrazo('2026-04-01', 3).vencimento, '2026-04-08');
});

test('SQL de detected-deadlines.ts não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([routePath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});
