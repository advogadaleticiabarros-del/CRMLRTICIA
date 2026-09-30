// Fechamento do dia v2 (diagnóstico ago/2026): usa de verdade o retrato da
// manhã, separa "aguardando terceiro", lista prioridade de amanhã e escolhe
// frase de encerramento pelo contexto, sem repetir as recentes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fechamento-'));
execSync(`npx tsc src/services/fechamentoDia.ts --outDir "${out}" --module commonjs --target es2020 --skipLibCheck --types node`, { stdio: 'pipe' });
const m = (await import(pathToFileURL(path.join(out, 'fechamentoDia.js')).href)).default;

test('item da manhã que saiu da lista de hoje (reagendado) ainda aparece como pendente', () => {
  const manha = { tarefas: [{ id: 1, titulo: 'Petição X', status: 'pendente' }] };
  const r = m.classificarDia(manha, { tarefas: [] }, new Map([[1, { id: 1, titulo: 'Petição X', status: 'pendente' }]]));
  assert.deepEqual(r.pendentes, ['Petição X']);
});

test('item da manhã concluído hoje aparece como concluído mesmo sem estar na lista de hoje', () => {
  const manha = { tarefas: [{ id: 1, titulo: 'Petição X', status: 'pendente' }] };
  const r = m.classificarDia(manha, { tarefas: [] }, new Map([[1, { id: 1, titulo: 'Petição X', status: 'concluida' }]]));
  assert.deepEqual(r.concluidos, ['Petição X']);
});

test('aguardando terceiro vai para bloco próprio, com quem', () => {
  const agora = { tarefas: [{ id: 3, titulo: 'Contrato', status: 'aguardando_terceiro', waiting_on: 'cliente' }] };
  const r = m.classificarDia(null, agora, new Map());
  assert.deepEqual(r.aguardando, ['Contrato (aguardando cliente)']);
  assert.deepEqual(r.pendentes, []);
});

test('cancelada não aparece em lugar nenhum; sem duplicar item da manhã e de agora', () => {
  const t = { id: 1, titulo: 'A', status: 'pendente' };
  const r = m.classificarDia({ tarefas: [t] }, { tarefas: [t, { id: 2, titulo: 'B', status: 'cancelada' }] }, new Map([[1, t]]));
  assert.deepEqual(r.pendentes, ['A']);
  assert.deepEqual(r.concluidos, []);
});

test('são 100 frases, sem repetição, em todas as categorias', () => {
  const todas = Object.values(m.FRASES).flat();
  assert.equal(todas.length, 100);
  assert.equal(new Set(todas).size, 100);
  for (const c of ['descanso', 'audiencia', 'dia_cheio', 'pendencias', 'academia', 'hidratacao', 'leitura']) assert.ok(m.FRASES[c]?.length, c);
});

test('categoria pelo contexto', () => {
  assert.equal(m.categoriaDoDia({ teveAudiencia: true, concluidos: 0, pendentes: 0, academiaAmanha: false }), 'audiencia');
  assert.equal(m.categoriaDoDia({ teveAudiencia: false, concluidos: 0, pendentes: 0, academiaAmanha: true }), 'academia');
  assert.equal(m.categoriaDoDia({ teveAudiencia: false, concluidos: 6, pendentes: 1, academiaAmanha: false }), 'dia_cheio');
  assert.equal(m.categoriaDoDia({ teveAudiencia: false, concluidos: 1, pendentes: 6, academiaAmanha: false }), 'pendencias');
  assert.ok(['descanso', 'hidratacao', 'leitura'].includes(m.categoriaDoDia({ teveAudiencia: false, concluidos: 1, pendentes: 1, academiaAmanha: false }, () => 0.5)));
});

test('sorteio evita as frases usadas recentemente', () => {
  const cat = m.FRASES.audiencia;
  const recentes = cat.slice(0, cat.length - 1);
  const f = m.sortearFrase('audiencia', recentes, () => 0);
  assert.equal(f, cat[cat.length - 1]);
  // se todas já foram usadas, sorteia mesmo assim (não trava)
  assert.ok(cat.includes(m.sortearFrase('audiencia', cat, () => 0)));
});

test('texto de WhatsApp enxuto com os blocos', () => {
  const t = m.textoWhatsapp('Letícia', { concluidos: ['A', 'B'], pendentes: ['C'], aguardando: ['D (aguardando perito)'] }, ['Prazo X amanhã'], 'Descanse.');
  assert.match(t, /Fechamento do dia/);
  assert.match(t, /✅ 2 concluíd/);
  assert.match(t, /C/);
  assert.match(t, /aguardando perito/);
  assert.match(t, /Prazo X amanhã/);
  assert.match(t, /Descanse\./);
});
