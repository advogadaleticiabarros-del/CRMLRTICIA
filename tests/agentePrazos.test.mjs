// Agente de prazos (Dra. Paula) — 18/11/2026. Nomes e números FICTÍCIOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInterpretacao, analisarComInterpretacao, parseJulgamento, avaliarCumprimento, rodarAgentePrazos, montarMensagem,
} from '../dist/services/agentePrazos.js';

const NUM = '5000001-11.2026.8.08.0024'; // TJES, rito comum

test('interpretação da IA: só valores da lista; dias só para prazo escrito', () => {
  assert.deepEqual(parseInterpretacao('```json\n{"tipo":"sentenca","destinatario":"nosso_cliente","resumo":"Julgou procedente."}\n```'),
    { tipo: 'sentenca', destinatario: 'nosso_cliente', dias: null, corridos: false, resumo: 'Julgou procedente.' });
  assert.equal(parseInterpretacao('{"tipo":"inventado"}').tipo, 'incerto');
  assert.equal(parseInterpretacao('lixo'), null);
  const p = parseInterpretacao('{"tipo":"prazo_escrito","dias":"5","destinatario":"nosso_cliente"}');
  assert.equal(p.dias, 5);
  assert.equal(parseInterpretacao('{"tipo":"prazo_escrito","dias":400}').tipo, 'incerto', 'dias absurdos');
});

test('a data sai do código, não da IA: sentença no rito comum = apelação de 15 dias úteis', () => {
  const a = analisarComInterpretacao({ numeroProcesso: NUM, disponibilizacao: '2026-11-16' },
    { tipo: 'sentenca', destinatario: 'nosso_cliente', dias: null, corridos: false, resumo: '' });
  assert.equal(a.categoria, 'prazo');
  assert.equal(a.dias, 15);
  assert.ok(a.termoFinal > '2026-12-01');
  const c = analisarComInterpretacao({ numeroProcesso: NUM, disponibilizacao: '2026-11-16' },
    { tipo: 'prazo_escrito', destinatario: 'nosso_cliente', dias: 5, corridos: false, resumo: '' });
  assert.equal(c.dias, 5);
  assert.equal(analisarComInterpretacao({ numeroProcesso: NUM, disponibilizacao: '2026-11-16' },
    { tipo: 'citacao', destinatario: 'nosso_cliente', dias: null, corridos: false, resumo: '' }).categoria, 'revisao');
  assert.equal(analisarComInterpretacao({ numeroProcesso: NUM, disponibilizacao: '2026-11-16' },
    { tipo: 'sentenca', destinatario: 'outra_parte', dias: null, corridos: false, resumo: '' }), null, 'ordem para a outra parte: não define');
});

const MOVS = [
  { id: 10, data: '2026-11-20', titulo: 'Juntada de petição', texto: 'Juntada de contrarrazões apresentadas por MARIA EXEMPLO, adv. LETICIA ELIAS BARROS OAB/ES 39948' },
  { id: 11, data: '2026-11-21', titulo: 'Petição', texto: 'Petição da parte ré' },
];
const CTX = { cliente: 'Maria Exemplo', desde: '2026-11-17', termos: ['LETICIA ELIAS BARROS', '39948'] };

test('cumprido só com prova: IA diz sim, nosso cliente, movimento existe, é posterior e o texto cita a Dra./OAB/cliente', () => {
  const j = parseJulgamento('{"cumprido":"sim","movimento_id":10,"quem":"nosso_cliente","motivo":"Contrarrazões juntadas pela nossa parte."}');
  assert.deepEqual(avaliarCumprimento(j, MOVS, CTX), { resultado: 'cumprido', movimentoId: 10, motivo: 'Contrarrazões juntadas pela nossa parte.' });
  assert.equal(avaliarCumprimento({ ...j, movimento_id: 11 }, MOVS, CTX).resultado, 'provavel', 'texto não cita a Dra. nem o cliente');
  assert.equal(avaliarCumprimento({ ...j, movimento_id: 99 }, MOVS, CTX).resultado, 'nao', 'movimento inventado');
  assert.equal(avaliarCumprimento({ ...j, quem: 'outra_parte' }, MOVS, CTX).resultado, 'nao');
  assert.equal(avaliarCumprimento({ ...j, cumprido: 'incerto' }, MOVS, CTX).resultado, 'provavel');
  assert.equal(avaliarCumprimento(j, MOVS, { ...CTX, desde: '2026-11-25' }).resultado, 'nao', 'movimento anterior à intimação');
  assert.equal(avaliarCumprimento(null, MOVS, CTX).resultado, 'nao');
});

test('TJES informa quem juntou: petição juntada pela Dra. no dia do movimento vira prova (28/11/2026)', () => {
  // No PJe, pelo MNI, o movimento vem só como "Petição", sem citar ninguém.
  const j = parseJulgamento('{"cumprido":"sim","movimento_id":11,"quem":"nosso_cliente","motivo":"Manifestação juntada."}');
  const comJuntada = { ...CTX, juntadasPelaDra: ['2026-11-21'] };
  const r = avaliarCumprimento(j, MOVS, comJuntada);
  assert.equal(r.resultado, 'cumprido');
  assert.equal(r.movimentoId, 11);
  assert.match(r.motivo, /juntada pela Dra\. no tribunal em 21\/11/);
  assert.equal(avaliarCumprimento(j, MOVS, { ...CTX, juntadasPelaDra: ['2026-11-22'] }).resultado, 'provavel', 'juntada em outro dia não prova');
  assert.equal(avaliarCumprimento({ ...j, cumprido: 'incerto' }, MOVS, comJuntada).resultado, 'provavel', 'IA em dúvida: só provável');
  assert.equal(avaliarCumprimento({ ...j, quem: 'outra_parte' }, MOVS, comJuntada).resultado, 'provavel', 'IA disse outra parte, mas a Dra. juntou: confirmar');
  assert.equal(avaliarCumprimento({ ...j, quem: 'outra_parte' }, MOVS, CTX).resultado, 'nao', 'sem juntada da Dra., segue como antes');
  assert.equal(avaliarCumprimento({ ...j, cumprido: 'nao' }, MOVS, comJuntada).resultado, 'nao', 'IA leu que não cumpriu');
});

function depsFalsas(over = {}) {
  const log = { definidos: [], leitura: [], cumpridos: [], tratadas: [], marcados: [], mensagens: [] };
  const deps = {
    hoje: () => '2026-11-18',
    prazosAConfirmar: async () => [],
    interpretar: async () => null,
    definirPrazo: async (d, a, origem) => { log.definidos.push([d.id, a.termoFinal, origem]); return { deadlineId: 100 + d.id }; },
    registrarExame: async (id, nota) => { log.marcados.push([id, nota]); },
    marcarAndamentoTratado: async (id) => { log.tratadas.push(id); },
    prazosPendentes: async () => [],
    movimentosDepois: async () => [],
    julgar: async () => null,
    marcarCumprido: async (id, ev) => { log.cumpridos.push([id, ev]); },
    registrarVerificacao: async () => {},
    avisar: async (t) => { log.mensagens.push(t); return true; },
    ...over,
  };
  return { deps, log };
}

const analise = (o) => ({ categoria: 'prazo', ato: 'Contrarrazões', dias: 15, termoFinal: '2026-12-09', protocolarAte: '2026-12-08', explicacao: '', ...o });

test('rodada: prazo certo vira prazo; revisão vai para a IA; incerto pede leitura; vencido não vira prazo', async () => {
  const { deps, log } = depsFalsas({
    prazosAConfirmar: async () => [
      { id: 1, movementId: 501, numero: NUM, cliente: 'Ana', texto: 'contrarrazões', disponibilizacao: '2026-11-17', analise: analise() },
      { id: 2, movementId: 502, numero: NUM, cliente: 'Bia', texto: 'Vistos. Sentença...', disponibilizacao: '2026-11-16', analise: analise({ categoria: 'revisao', ato: 'Revisão humana', termoFinal: null }) },
      { id: 3, movementId: 503, numero: NUM, cliente: 'Caio', texto: 'texto confuso', disponibilizacao: '2026-11-16', analise: null },
      { id: 4, movementId: 504, numero: NUM, cliente: 'Dora', texto: 'contrarrazões', disponibilizacao: '2026-10-01', analise: analise({ termoFinal: '2026-10-23' }) },
    ],
    interpretar: async (t) => (t.startsWith('Vistos')
      ? { tipo: 'sentenca', destinatario: 'nosso_cliente', dias: null, corridos: false, resumo: 'Sentença de procedência.' }
      : { tipo: 'incerto', destinatario: 'incerto', dias: null, corridos: false, resumo: 'Não dá para saber.' }),
  });
  const r = await rodarAgentePrazos(deps);
  assert.deepEqual(log.definidos.map((d) => [d[0], d[2]]), [[1, 'regra'], [2, 'ia']]);
  assert.deepEqual(log.tratadas, [501, 502]);
  assert.equal(r.definidos, 2);
  assert.equal(r.paraLer, 1);
  assert.equal(r.vencidosSemRegistro, 1);
  assert.deepEqual(log.marcados.map((m) => m[0]).sort(), [3, 4]);
  assert.equal(log.mensagens.length, 1);
  const msg = log.mensagens[0];
  assert.match(msg, /Ana/);
  assert.match(msg, /conferir/i, 'o definido pela IA vem marcado para conferir');
  assert.match(msg, /Caio/);
  assert.match(msg, /Dora/);
});

test('rodada: cumprimento com prova marca cumprido; sem prova só avisa; sem movimento novo nem chama a IA', async () => {
  let chamadasIa = 0;
  const { deps, log } = depsFalsas({
    prazosPendentes: async () => [
      { id: 7, processId: 1, cliente: 'Maria Exemplo', ato: 'Contrarrazões', termo: '2026-12-09', desde: '2026-11-17', ultimoMovVerificado: null, intimacao: '...' },
      { id: 8, processId: 2, cliente: 'Outra Pessoa', ato: 'Réplica', termo: '2026-12-01', desde: '2026-11-17', ultimoMovVerificado: null, intimacao: '...' },
      { id: 9, processId: 3, cliente: 'Sem Novidade', ato: 'Réplica', termo: '2026-11-19', desde: '2026-11-10', ultimoMovVerificado: 50, intimacao: '...' },
    ],
    movimentosDepois: async (pid) => (pid === 1 ? MOVS : pid === 2 ? [MOVS[1]] : []),
    julgar: async (p) => { chamadasIa++; return { cumprido: 'sim', movimento_id: p.id === 7 ? 10 : 11, quem: 'nosso_cliente', motivo: 'Petição juntada.' }; },
    termosDoEscritorio: ['LETICIA ELIAS BARROS', '39948'],
  });
  const r = await rodarAgentePrazos(deps);
  assert.equal(chamadasIa, 2);
  assert.deepEqual(log.cumpridos.map((c) => c[0]), [7]);
  assert.equal(r.cumpridos, 1);
  assert.equal(r.provaveis, 1);
  assert.match(log.mensagens[0], /Maria Exemplo/);
  assert.match(log.mensagens[0], /Outra Pessoa/);
  assert.match(log.mensagens[0], /Sem Novidade/, 'vence amanhã: lembra');
});

test('sem novidade: não manda mensagem', async () => {
  const { deps, log } = depsFalsas();
  await rodarAgentePrazos(deps);
  assert.equal(log.mensagens.length, 0);
  assert.equal(montarMensagem({ definidos: [], paraLer: [], vencidos: [], cumpridos: [], provaveis: [], vencendo: [] }), null);
});
