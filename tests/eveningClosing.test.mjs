// tests/eveningClosing.test.mjs
// A comparação em si (snapshot da manhã vs. estado agora) é testada isolada,
// sem depender de banco — recebe os dois conjuntos já prontos.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/eveningClosingService.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { compararSnapshotComEstadoAtual } = await import('../dist/services/eveningClosingService.js');

test('item que estava pendente de manhã e virou concluído aparece em concluidos', () => {
  const manha = { tarefas: [{ id: 1, titulo: 'Petição X', status: 'pendente' }] };
  const agora = { tarefas: [{ id: 1, titulo: 'Petição X', status: 'concluida' }] };
  const r = compararSnapshotComEstadoAtual(manha, agora);
  assert.deepEqual(r.concluidos, ['Petição X']);
  assert.deepEqual(r.pendentes, []);
});

test('item que continua pendente aparece em pendentes', () => {
  const manha = { tarefas: [{ id: 1, titulo: 'Petição X', status: 'pendente' }] };
  const agora = { tarefas: [{ id: 1, titulo: 'Petição X', status: 'pendente' }] };
  const r = compararSnapshotComEstadoAtual(manha, agora);
  assert.deepEqual(r.pendentes, ['Petição X']);
});

test('item novo que não estava no snapshot da manhã e já foi concluído também conta (regra: tudo que mudou hoje)', () => {
  const manha = { tarefas: [] };
  const agora = { tarefas: [{ id: 2, titulo: 'Tarefa nova', status: 'concluida' }] };
  const r = compararSnapshotComEstadoAtual(manha, agora);
  assert.deepEqual(r.concluidos, ['Tarefa nova']);
});

test('sem snapshot da manhã (usuária não recebeu briefing hoje), compara contra vazio sem lançar', () => {
  const r = compararSnapshotComEstadoAtual(null, { tarefas: [{ id: 1, titulo: 'X', status: 'concluida' }] });
  assert.deepEqual(r.concluidos, ['X']);
});
