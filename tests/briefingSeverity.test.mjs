// tests/briefingSeverity.test.mjs
// Regra fixa por tipo de item (não delegada a IA) — ver seção 3 do spec
// docs/superpowers/specs/2026-08-21-briefing-matinal-design.md.
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/services/briefingSeverity.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const {
  classificarPrazo, classificarAgenda, classificarPagamento,
  classificarMovimentacao, classificarEsteira, classificarLead, top3,
} = await import('../dist/services/briefingSeverity.js');

test('prazo hoje ou amanhã é crítico', () => {
  assert.equal(classificarPrazo(0), 'critica');
  assert.equal(classificarPrazo(1), 'critica');
});
test('prazo em 3 dias é atenção, em mais de 3 é acompanhamento', () => {
  assert.equal(classificarPrazo(3), 'atencao');
  assert.equal(classificarPrazo(7), 'acompanhamento');
});

test('compromisso de agenda hoje é crítico, senão acompanhamento', () => {
  assert.equal(classificarAgenda(true), 'critica');
  assert.equal(classificarAgenda(false), 'acompanhamento');
});

test('pagamento vencendo hoje é crítico; em breve é atenção; futuro é pode_esperar', () => {
  assert.equal(classificarPagamento(0), 'critica');
  assert.equal(classificarPagamento(2), 'atencao');
  assert.equal(classificarPagamento(10), 'pode_esperar');
});

test('movimentação com prioridade Alta é crítica, Média é atenção, Baixa/nula é acompanhamento', () => {
  assert.equal(classificarMovimentacao('Alta'), 'critica');
  assert.equal(classificarMovimentacao('Média'), 'atencao');
  assert.equal(classificarMovimentacao('Baixa'), 'acompanhamento');
  assert.equal(classificarMovimentacao(null), 'acompanhamento');
});

test('caso parado na esteira > 10 dias é atenção; <= 10 é pode_esperar', () => {
  assert.equal(classificarEsteira(11), 'atencao');
  assert.equal(classificarEsteira(10), 'pode_esperar');
  assert.equal(classificarEsteira(3), 'pode_esperar');
});

test('lead sem resposta < 48h é acompanhamento; >= 48h é pode_esperar (já frio)', () => {
  assert.equal(classificarLead(10), 'acompanhamento');
  assert.equal(classificarLead(48), 'pode_esperar');
  assert.equal(classificarLead(72), 'pode_esperar');
});

test('top3 pega só os críticos, ordenados por ordemDesempate, no máximo 3', () => {
  const itens = [
    { id: 'a', kind: 'movimentacao', label: 'A', severity: 'critica', ordemDesempate: 4 },
    { id: 'b', kind: 'prazo', label: 'B', severity: 'critica', ordemDesempate: 1 },
    { id: 'c', kind: 'agenda', label: 'C', severity: 'critica', ordemDesempate: 2 },
    { id: 'd', kind: 'pagamento', label: 'D', severity: 'critica', ordemDesempate: 5 },
    { id: 'e', kind: 'esteira', label: 'E', severity: 'atencao', ordemDesempate: 1 },
  ];
  const r = top3(itens);
  assert.deepEqual(r.map((i) => i.id), ['b', 'c', 'a']);
});

test('top3 com menos de 3 críticos devolve só os que existem', () => {
  const itens = [
    { id: 'a', kind: 'prazo', label: 'A', severity: 'critica', ordemDesempate: 1 },
  ];
  assert.deepEqual(top3(itens).map((i) => i.id), ['a']);
});

test('top3 em empate de ordemDesempate desempata por PESO_KIND (prazo antes de pagamento)', () => {
  const itens = [
    { id: 'a', kind: 'pagamento', label: 'A', severity: 'critica', ordemDesempate: 1 },
    { id: 'b', kind: 'prazo', label: 'B', severity: 'critica', ordemDesempate: 1 },
  ];
  const r = top3(itens);
  assert.deepEqual(r.map((i) => i.id), ['b', 'a']);
});

test('top3 sem nenhum crítico devolve lista vazia', () => {
  const itens = [
    { id: 'a', kind: 'esteira', label: 'A', severity: 'atencao', ordemDesempate: 1 },
  ];
  assert.deepEqual(top3(itens), []);
});
