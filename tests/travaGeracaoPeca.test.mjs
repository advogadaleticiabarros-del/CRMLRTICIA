// tests/travaGeracaoPeca.test.mjs — Trava da geração da peça (pedido da Jessica,
// 30/10/2026): "trave o botão depois do primeiro clique, até chegar a versão".
// Dois cliques na mesma ação não podem gerar duas versões nem pagar a IA duas vezes.
import { test } from 'node:test';
import assert from 'node:assert';
import { criarTravaGeracao, ETAPAS_GERACAO } from '../dist/services/travaGeracaoPeca.js';

test('o primeiro pedido trava; o segundo da mesma peça é recusado', () => {
  const t = criarTravaGeracao();
  assert.strictEqual(t.iniciar(110), true);
  assert.strictEqual(t.iniciar(110), false);
  assert.ok(t.emAndamento(110));
});

test('peças diferentes geram ao mesmo tempo', () => {
  const t = criarTravaGeracao();
  assert.strictEqual(t.iniciar(110), true);
  assert.strictEqual(t.iniciar(111), true);
});

test('ao terminar, a peça pode ser gerada de novo', () => {
  const t = criarTravaGeracao();
  t.iniciar(110);
  t.terminar(110);
  assert.strictEqual(t.emAndamento(110), null);
  assert.strictEqual(t.iniciar(110), true);
});

test('emAndamento diz desde quando', () => {
  let agora = new Date('2026-10-30T20:00:00Z');
  const t = criarTravaGeracao({ agora: () => agora });
  t.iniciar(110);
  assert.deepStrictEqual(t.emAndamento(110).desde, new Date('2026-10-30T20:00:00Z'));
});

test('trava esquecida (servidor travou no meio) solta sozinha depois de 30 minutos', () => {
  let agora = new Date('2026-10-30T20:00:00Z');
  const t = criarTravaGeracao({ agora: () => agora });
  t.iniciar(110);
  agora = new Date('2026-10-30T20:29:00Z');
  assert.strictEqual(t.iniciar(110), false);
  agora = new Date('2026-10-30T20:31:00Z');
  assert.strictEqual(t.emAndamento(110), null);
  assert.strictEqual(t.iniciar(110), true);
});

test('executar trava durante a tarefa e solta mesmo se ela falhar', async () => {
  const t = criarTravaGeracao();
  let durante = null;
  const r = await t.executar(110, async () => { durante = t.emAndamento(110); return 'ok'; });
  assert.strictEqual(r.iniciou, true);
  assert.strictEqual(r.valor, 'ok');
  assert.ok(durante);
  assert.strictEqual(t.emAndamento(110), null);

  await assert.rejects(t.executar(110, async () => { throw new Error('IA fora'); }));
  assert.strictEqual(t.emAndamento(110), null);
});

test('executar não roda a tarefa se a peça já está sendo gerada', async () => {
  const t = criarTravaGeracao();
  t.iniciar(110);
  let rodou = false;
  const r = await t.executar(110, async () => { rodou = true; });
  assert.strictEqual(r.iniciou, false);
  assert.strictEqual(rodou, false);
});

// Barra de progresso (30/10/2026): "é muito difícil ficar aguardando sem saber de nada".

test('a trava guarda a etapa e diz o passo e o rótulo para a barra', () => {
  const t = criarTravaGeracao();
  t.iniciar(110);
  assert.strictEqual(t.emAndamento(110).etapa, 'inicio');
  t.marcar(110, 'redacao');
  const a = t.emAndamento(110);
  assert.strictEqual(a.etapa, 'redacao');
  const i = ETAPAS_GERACAO.findIndex((e) => e.id === 'redacao');
  assert.strictEqual(a.passo, i + 1);
  assert.strictEqual(a.total, ETAPAS_GERACAO.length);
  assert.match(a.rotulo, /redig/i);
});

test('marcar etapa de peça que não está sendo gerada não cria trava', () => {
  const t = criarTravaGeracao();
  t.marcar(110, 'redacao');
  assert.strictEqual(t.emAndamento(110), null);
});
