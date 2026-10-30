// tests/tarefasEmAndamento.test.mjs — Tarefas demoradas com barra e confirmação de
// conclusão (pedido da Jessica, 30/10/2026): "toda ação preciso de confirmação de
// conclusão, pode colocar barras também para acompanhamento, exemplo leitura de
// documentos, atualização de pasta, tudo que eu precise esperar para finalizar".
import { test } from 'node:test';
import assert from 'node:assert';
import { criarTarefas } from '../dist/services/tarefasEmAndamento.js';

const relogio = (inicio = '2026-10-30T20:00:00Z') => {
  let t = new Date(inicio).getTime();
  return { agora: () => new Date(t), passar: (ms) => { t += ms; } };
};
const espera = () => new Promise((r) => setTimeout(r, 5));

test('a tarefa aparece para quem pediu, rodando e sem porcentagem quando não há contagem', () => {
  const r = criarTarefas();
  r.iniciar({ userId: 1, tipo: 'pasta', titulo: 'Ler a pasta do Drive', caseId: 115 });
  const [t] = r.listar(1);
  assert.strictEqual(t.estado, 'rodando');
  assert.strictEqual(t.titulo, 'Ler a pasta do Drive');
  assert.strictEqual(t.caseId, 115);
  assert.strictEqual(t.pct, null);
  assert.deepStrictEqual(r.listar(2), [], 'outra pessoa não vê a tarefa');
});

test('etapa com contagem vira porcentagem e rótulo ("Lendo 3 de 10")', () => {
  const r = criarTarefas();
  const c = r.iniciar({ userId: 1, tipo: 'pasta', titulo: 'Ler a pasta' });
  c.etapa('Lendo RG.pdf', 3, 10);
  const [t] = r.listar(1);
  assert.strictEqual(t.pct, 30);
  assert.strictEqual(t.rotulo, 'Lendo RG.pdf');
  assert.strictEqual(t.feito, 3);
  assert.strictEqual(t.total, 10);
});

test('rodando nunca mostra 100%: a barra só enche quando conclui', () => {
  const r = criarTarefas();
  const c = r.iniciar({ userId: 1, tipo: 'pasta', titulo: 'x' });
  c.etapa('último arquivo', 10, 10);
  assert.strictEqual(r.listar(1)[0].pct, 99);
  c.concluir('10 arquivos lidos');
  const [t] = r.listar(1);
  assert.strictEqual(t.estado, 'concluida');
  assert.strictEqual(t.pct, 100);
  assert.strictEqual(t.resultado, '10 arquivos lidos');
});

test('a conclusão fica na tela até a pessoa dar OK', () => {
  const rel = relogio(); const r = criarTarefas({ agora: rel.agora });
  const c = r.iniciar({ userId: 1, tipo: 'revisao', titulo: 'Revisão' });
  c.concluir('pronta');
  rel.passar(3 * 60 * 60 * 1000);
  assert.strictEqual(r.listar(1).length, 1, 'continua visível horas depois');
  assert.strictEqual(r.dispensar(1, c.id), true);
  assert.deepStrictEqual(r.listar(1), []);
});

test('só quem pediu dispensa a tarefa', () => {
  const r = criarTarefas();
  const c = r.iniciar({ userId: 1, tipo: 'x', titulo: 'x' });
  c.concluir('ok');
  assert.strictEqual(r.dispensar(2, c.id), false);
  assert.strictEqual(r.listar(1).length, 1);
});

test('dispensar todas as terminadas não apaga as que ainda rodam', () => {
  const r = criarTarefas();
  r.iniciar({ userId: 1, tipo: 'a', titulo: 'rodando' });
  r.iniciar({ userId: 1, tipo: 'b', titulo: 'feita' }).concluir('ok');
  r.iniciar({ userId: 1, tipo: 'c', titulo: 'falhou' }).falhar('erro');
  assert.strictEqual(r.dispensarTerminadas(1), 2);
  assert.deepStrictEqual(r.listar(1).map((t) => t.titulo), ['rodando']);
});

test('o primeiro desfecho vale (concluir depois de falhar não muda)', () => {
  const r = criarTarefas();
  const c = r.iniciar({ userId: 1, tipo: 'x', titulo: 'x' });
  c.falhar('A pasta não está compartilhada');
  c.concluir('ok');
  c.etapa('outra', 1, 2);
  const [t] = r.listar(1);
  assert.strictEqual(t.estado, 'falhou');
  assert.strictEqual(t.resultado, 'A pasta não está compartilhada');
});

test('rodar: executa em segundo plano e conclui ou falha pelo resultado', async () => {
  const r = criarTarefas();
  r.rodar({ userId: 1, tipo: 'a', titulo: 'ok' }, async (c) => { c.etapa('meio', 1, 2); return { ok: true, mensagem: 'feito' }; });
  r.rodar({ userId: 1, tipo: 'b', titulo: 'não ok' }, async () => ({ ok: false, mensagem: 'sem documentos' }));
  r.rodar({ userId: 1, tipo: 'c', titulo: 'quebrou' }, async () => { throw new Error('IA fora do ar'); });
  await espera();
  const por = Object.fromEntries(r.listar(1).map((t) => [t.titulo, t]));
  assert.strictEqual(por['ok'].estado, 'concluida');
  assert.strictEqual(por['ok'].resultado, 'feito');
  assert.strictEqual(por['não ok'].estado, 'falhou');
  assert.strictEqual(por['não ok'].resultado, 'sem documentos');
  assert.strictEqual(por['quebrou'].estado, 'falhou');
  assert.match(por['quebrou'].resultado, /IA fora do ar/);
});

test('acompanhar: o andamento vem de outra fonte (etapas da geração da peça)', () => {
  const r = criarTarefas();
  let fonte = { rotulo: 'Etapa 2 de 9: lendo', feito: 1.5, total: 9 };
  const c = r.iniciar({ userId: 1, tipo: 'peca', titulo: 'Peça' });
  c.acompanhar(() => fonte);
  assert.strictEqual(r.listar(1)[0].rotulo, 'Etapa 2 de 9: lendo');
  assert.strictEqual(r.listar(1)[0].pct, 17);
  fonte = null; // a fonte sumiu: fica o último andamento
  assert.strictEqual(r.listar(1)[0].rotulo, 'Etapa 2 de 9: lendo');
});

test('tarefa presa por muito tempo vira falha com explicação (nunca barra eterna)', () => {
  const rel = relogio(); const r = criarTarefas({ agora: rel.agora });
  r.iniciar({ userId: 1, tipo: 'pasta', titulo: 'Ler a pasta' });
  rel.passar(3 * 60 * 60 * 1000);
  const [t] = r.listar(1);
  assert.strictEqual(t.estado, 'falhou');
  assert.match(t.resultado, /parou sem resposta/i);
});

test('terminadas antigas somem sozinhas depois de um dia', () => {
  const rel = relogio(); const r = criarTarefas({ agora: rel.agora });
  r.iniciar({ userId: 1, tipo: 'x', titulo: 'x' }).concluir('ok');
  rel.passar(25 * 60 * 60 * 1000);
  assert.deepStrictEqual(r.listar(1), []);
});

test('lista: as que rodam primeiro, depois as terminadas mais recentes', () => {
  const rel = relogio(); const r = criarTarefas({ agora: rel.agora });
  r.iniciar({ userId: 1, tipo: 'x', titulo: 'antiga' }).concluir('ok');
  rel.passar(1000);
  r.iniciar({ userId: 1, tipo: 'x', titulo: 'rodando' });
  rel.passar(1000);
  r.iniciar({ userId: 1, tipo: 'x', titulo: 'recente' }).concluir('ok');
  assert.deepStrictEqual(r.listar(1).map((t) => t.titulo), ['rodando', 'recente', 'antiga']);
});

test('segundos: tempo decorrido (até o fim, se terminou)', () => {
  const rel = relogio(); const r = criarTarefas({ agora: rel.agora });
  const c = r.iniciar({ userId: 1, tipo: 'x', titulo: 'x' });
  rel.passar(90 * 1000);
  assert.strictEqual(r.listar(1)[0].segundos, 90);
  c.concluir('ok');
  rel.passar(60 * 1000);
  assert.strictEqual(r.listar(1)[0].segundos, 90);
});
