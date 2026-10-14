// tests/escritorioVirtual.test.mjs — escritório virtual: agentes, status e última ação
import { test } from 'node:test';
import assert from 'node:assert';
import { AGENTES, statusDoAgente, textoDaRotina, montarEscritorio } from '../dist/services/escritorioVirtual.js';

const AGORA = new Date('2026-10-14T15:00:00Z');
const min = (n) => new Date(AGORA.getTime() - n * 60000);

test('AGENTES: ids únicos, toda rotina pertence a um agente só, e Laya, Secretária e Leitor existem', () => {
  const ids = AGENTES.map((a) => a.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  const jobs = AGENTES.flatMap((a) => a.jobs);
  assert.strictEqual(new Set(jobs).size, jobs.length);
  for (const id of ['laya', 'secretaria', 'leitor']) assert.ok(ids.includes(id), id);
});

test('AGENTES: todo agente tem um resumo curto do que faz (linha do cartão)', () => {
  for (const a of AGENTES) {
    assert.ok(a.resumo && a.resumo.length <= 70, `${a.id}: ${a.resumo}`);
  }
});

test('montarEscritorio: leva o resumo e as métricas de cada agente para o cartão', () => {
  const lista = montarEscritorio([], [], AGORA, { layaOnline: true, metricas: { leitor: [{ n: 2, rotulo: 'decisões lidas hoje' }] } });
  const leitor = lista.find((a) => a.id === 'leitor');
  assert.ok(leitor.resumo);
  assert.deepStrictEqual(leitor.metricas, [{ n: 2, rotulo: 'decisões lidas hoje' }]);
  assert.deepStrictEqual(lista.find((a) => a.id === 'djen').metricas, []);
});

test('statusDoAgente: rodou há 5 min com sucesso → trabalhando, com a última ação', () => {
  const s = statusDoAgente(
    { id: 'x', jobs: ['monitoramento:processos'] },
    [{ job: 'monitoramento:processos', status: 'ok', message: '{"novas":3}', ran_at: min(5) }], [], AGORA);
  assert.strictEqual(s.status, 'trabalhando');
  assert.match(s.ultima.texto, /3/);
});

test('statusDoAgente: última execução com erro → erro (mesmo com sucesso antigo)', () => {
  const s = statusDoAgente(
    { id: 'x', jobs: ['backup:diario'] },
    [
      { job: 'backup:diario', status: 'erro', message: 'MEGA fora do ar', ran_at: min(60) },
      { job: 'backup:diario', status: 'ok', message: null, ran_at: min(600) },
    ], [], AGORA);
  assert.strictEqual(s.status, 'erro');
  assert.match(s.ultima.texto, /MEGA fora do ar/);
});

test('statusDoAgente: rodou nas últimas 26h, mas não agora → parado', () => {
  const s = statusDoAgente({ id: 'x', jobs: ['carteira:vigia'] },
    [{ job: 'carteira:vigia', status: 'ok', message: null, ran_at: min(300) }], [], AGORA);
  assert.strictEqual(s.status, 'parado');
});

test('statusDoAgente: nada nas últimas 26h → desligado; em construção → desligado com aviso', () => {
  assert.strictEqual(statusDoAgente({ id: 'x', jobs: ['a:b'] }, [], [], AGORA).status, 'desligado');
  const c = statusDoAgente({ id: 'x', jobs: [], emConstrucao: true }, [], [], AGORA);
  assert.strictEqual(c.status, 'desligado');
  assert.match(c.ultima.texto, /constru/i);
});

test('statusDoAgente: ação registrada há 2 min conta como trabalho', () => {
  const s = statusDoAgente({ id: 'leitor', jobs: [] }, [],
    [{ agente: 'leitor', texto: 'leu a sentença de Maria Teste', created_at: min(2) }], AGORA);
  assert.strictEqual(s.status, 'trabalhando');
  assert.strictEqual(s.ultima.texto, 'leu a sentença de Maria Teste');
});

test('textoDaRotina: traduz o resumo JSON para português simples', () => {
  assert.strictEqual(textoDaRotina('leitor:decisoes-recentes', '{"lidas":2,"enviadas":2,"puladas":5}'), 'lidas: 2 · enviadas: 2 · puladas: 5');
  assert.strictEqual(textoDaRotina('prazos:contadores', null), 'concluiu a rotina');
  assert.strictEqual(textoDaRotina('x', 'texto livre'), 'texto livre');
});

test('montarEscritorio: devolve todos os agentes, cada um com só as rotinas dele', () => {
  const runs = [{ job: 'monitoramento:descoberta-oab', status: 'ok', message: '{"novos":1}', ran_at: min(3) }];
  const lista = montarEscritorio(runs, [], AGORA, { layaOnline: false });
  assert.strictEqual(lista.length, AGENTES.length);
  const dono = lista.find((a) => AGENTES.find((x) => x.id === a.id).jobs.includes('monitoramento:descoberta-oab'));
  assert.strictEqual(dono.status, 'trabalhando');
  assert.ok(lista.filter((a) => a.status === 'trabalhando').length === 1);
});

test('montarEscritorio: Laya fora do ar fica desligada e diz que falta instalar', () => {
  const laya = montarEscritorio([], [], AGORA, { layaOnline: false }).find((a) => a.id === 'laya');
  assert.strictEqual(laya.status, 'desligado');
  assert.match(laya.ultima.texto, /instal/i);
  const on = montarEscritorio([], [], AGORA, { layaOnline: true }).find((a) => a.id === 'laya');
  assert.notStrictEqual(on.status, 'desligado');
});
