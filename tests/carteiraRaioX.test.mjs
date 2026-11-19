// tests/carteiraRaioX.test.mjs — Dr. Vítor (vigia da carteira): raio-x diário,
// repasse de pendências aos colegas e relatório para a Dra. Dados fictícios.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  montarRaioX, compararComOntem, repassesPorColega, textoDoRepasse, falasDoRepasse,
  textoDoRaioX, avisoParaDra, resumoParaBriefing,
} from '../dist/services/carteiraRaioX.js';
import { conversaDeAcao } from '../dist/services/sociedadeAgentes.js';
import { AGENTES } from '../dist/services/escritorioVirtual.js';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const HOJE = '2026-11-19';
const proc = (o = {}) => ({
  id: 1, numero: '0000001-11.2026.5.17.0001', clienteId: 10, cliente: 'Maria Fictícia Souza', casoId: 100,
  fase: 'instrucao', faseSugerida: null, ultimaMov: '2026-11-10', ultimaConsulta: '2026-11-19', monitorado: true,
  valorCausa: 10000, prazosPendentes: 0, ...o,
});
const caso = (o = {}) => ({
  id: 100, titulo: 'Reclamatória trabalhista', clienteId: 10, cliente: 'Maria Fictícia Souza', area: 'trabalhista',
  prescricaoData: null, temProcesso: true, criadoEm: '2026-01-10', protocoladoEm: '2026-02-01', ...o,
});
const tipos = (r) => r.pendencias.map((p) => p.tipo).sort();

test('processo em dia não gera pendência e conta na saúde', () => {
  const r = montarRaioX([proc()], [caso()], HOJE);
  assert.deepStrictEqual(r.pendencias, []);
  assert.strictEqual(r.conferidos.processos, 1);
  assert.strictEqual(r.conferidos.casos, 1);
  assert.strictEqual(r.emDia, 1);
  assert.strictEqual(r.saude, 100);
});

test('parado: 30 dias vai à Dra. Paula; 60+ sem prazo vai ao Enzo; 90+ é grave', () => {
  const r30 = montarRaioX([proc({ ultimaMov: '2026-10-15' })], [], HOJE).pendencias[0];
  assert.strictEqual(r30.tipo, 'parado'); assert.strictEqual(r30.colega, 'prazos'); assert.strictEqual(r30.gravidade, 'baixa');
  const r60 = montarRaioX([proc({ ultimaMov: '2026-09-15' })], [], HOJE).pendencias[0];
  assert.strictEqual(r60.colega, 'estagiario'); assert.strictEqual(r60.gravidade, 'media');
  const r90 = montarRaioX([proc({ ultimaMov: '2026-07-01' })], [], HOJE).pendencias[0];
  assert.strictEqual(r90.gravidade, 'alta');
  assert.match(r90.motivo, /141 dias/);
  // com prazo em aberto, parado é espera normal: fica com a Dra. Paula
  const comPrazo = montarRaioX([proc({ ultimaMov: '2026-07-01', prazosPendentes: 1 })], [], HOJE).pendencias[0];
  assert.strictEqual(comPrazo.colega, 'prazos');
});

test('consulta ao tribunal atrasada vai à Dra. Tereza e substitui o "parado" (dado velho)', () => {
  const r = montarRaioX([proc({ ultimaMov: '2026-07-01', ultimaConsulta: '2026-11-10' })], [], HOJE);
  assert.deepStrictEqual(tipos(r), ['consulta_atrasada']);
  assert.strictEqual(r.pendencias[0].colega, 'tribunais');
  assert.strictEqual(r.pendencias[0].gravidade, 'alta'); // 9 dias
  const nunca = montarRaioX([proc({ ultimaConsulta: null })], [], HOJE).pendencias[0];
  assert.strictEqual(nunca.tipo, 'consulta_atrasada');
  assert.match(nunca.motivo, /nunca/);
});

test('fase desatualizada vai ao colega da fase sugerida', () => {
  const colega = (faseSugerida) => montarRaioX([proc({ faseSugerida })], [], HOJE).pendencias[0]?.colega;
  assert.strictEqual(colega('sentenca'), 'leitor');
  assert.strictEqual(colega('recurso'), 'leitor');
  assert.strictEqual(colega('execucao'), 'financeiro');
  assert.strictEqual(colega('encerrado'), 'secretaria');
  assert.strictEqual(colega('inicial'), undefined); // atrás da manual: não diverge
});

test('cadastro incompleto: sem cliente, sem caso, sem valor da causa, fora do monitoramento', () => {
  const r = montarRaioX([proc({ clienteId: null, cliente: null, casoId: null, valorCausa: null, monitorado: false })], [], HOJE);
  assert.deepStrictEqual(tipos(r), ['fora_do_monitoramento', 'sem_cliente', 'sem_valor_causa']);
  const semCaso = montarRaioX([proc({ casoId: null })], [], HOJE).pendencias[0];
  assert.strictEqual(semCaso.tipo, 'sem_caso');
  assert.strictEqual(semCaso.colega, 'secretaria');
});

test('fase encerrado com processo ainda ativo pede arquivamento à Dra. Clara', () => {
  const r = montarRaioX([proc({ fase: 'encerrado', ultimaMov: '2026-01-01' })], [], HOJE);
  assert.deepStrictEqual(tipos(r), ['encerrado_ativo']); // parado não conta para encerrado
  assert.strictEqual(r.pendencias[0].colega, 'secretaria');
});

test('prescrição: só caso sem processo; ≤15 dias ou vencida é crítica', () => {
  const g = (prescricaoData, temProcesso = false) => montarRaioX([], [caso({ prescricaoData, temProcesso, protocoladoEm: null })], HOJE).pendencias.find((p) => p.tipo === 'prescricao');
  assert.strictEqual(g('2026-11-25').gravidade, 'critica');
  assert.strictEqual(g('2026-11-01').gravidade, 'critica');
  assert.match(g('2026-11-01').motivo, /já passou/);
  assert.strictEqual(g('2026-12-10').gravidade, 'alta');
  assert.strictEqual(g('2027-02-01').gravidade, 'media');
  assert.strictEqual(g('2027-12-01'), undefined);
  assert.strictEqual(g('2026-11-25', true), undefined);
  assert.strictEqual(g('2026-11-25').colega, 'prazos');
});

test('ação não proposta: caso de área judicial sem processo há 30+ dias vai ao Enzo; com prescrição, só a prescrição', () => {
  const sem = (o) => montarRaioX([], [caso({ temProcesso: false, protocoladoEm: null, ...o })], HOJE).pendencias;
  assert.strictEqual(sem({ criadoEm: '2026-10-01' })[0].tipo, 'acao_nao_proposta');
  assert.strictEqual(sem({ criadoEm: '2026-10-01' })[0].colega, 'estagiario');
  assert.strictEqual(sem({ criadoEm: '2026-08-01' })[0].gravidade, 'alta');
  assert.deepStrictEqual(sem({ criadoEm: '2026-11-10' }), []); // recente
  assert.deepStrictEqual(sem({ criadoEm: '2026-08-01', area: 'outro' }), []); // consultoria
  assert.deepStrictEqual(sem({ criadoEm: '2026-08-01', protocoladoEm: '2026-08-05' }), []);
  assert.deepStrictEqual(sem({ criadoEm: '2026-08-01', prescricaoData: '2026-12-01' }).map((p) => p.tipo), ['prescricao']);
});

test('pendências em ordem de gravidade; saúde ignora ajustes leves de cadastro', () => {
  const r = montarRaioX([
    proc({ id: 1, valorCausa: null }),                       // só baixa → ainda em dia
    proc({ id: 2, numero: '0000002-22.2026.5.17.0001', ultimaMov: '2026-07-01' }), // alta
  ], [caso({ id: 5, prescricaoData: '2026-11-20', temProcesso: false, protocoladoEm: null })], HOJE);
  assert.deepStrictEqual(r.pendencias.map((p) => p.gravidade), ['critica', 'alta', 'baixa']);
  assert.strictEqual(r.emDia, 1);
  assert.strictEqual(r.saude, 50);
  assert.deepStrictEqual(r.contagem, { critica: 1, alta: 1, media: 0, baixa: 1 });
});

test('compararComOntem: novas, resolvidas e as que pioraram', () => {
  const r = montarRaioX([proc({ id: 1, ultimaMov: '2026-07-01' }), proc({ id: 2, faseSugerida: 'sentenca' })], [], HOJE);
  const ontem = [
    { ref: 'parado:lp:1', gravidade: 'media', tipo: 'parado', titulo: 'Proc. X' },
    { ref: 'parado:lp:9', gravidade: 'media', tipo: 'parado', titulo: 'Proc. 0000009' },
  ];
  const d = compararComOntem(r.pendencias, ontem);
  assert.deepStrictEqual(d.novas.map((p) => p.ref), ['fase_desatualizada:lp:2']);
  assert.deepStrictEqual(d.pioraram.map((p) => p.ref), ['parado:lp:1']);
  assert.deepStrictEqual(d.resolvidas.map((p) => p.ref), ['parado:lp:9']);
  assert.strictEqual(compararComOntem(r.pendencias, null).primeiraVez, true);
});

test('repasse aos colegas: agrupa, texto legível e vira conversa com o colega certo', () => {
  const r = montarRaioX([
    proc({ id: 1, ultimaConsulta: '2026-11-01' }),
    proc({ id: 2, numero: '0000002-22.2026.5.17.0001', ultimaConsulta: null }),
    proc({ id: 3, numero: '0000003-33.2026.5.17.0001', faseSugerida: 'sentenca' }),
  ], [], HOJE);
  const grupos = repassesPorColega(r.pendencias);
  assert.deepStrictEqual(grupos.map((g) => g.colega).sort(), ['leitor', 'tribunais']);
  const t = grupos.find((g) => g.colega === 'tribunais');
  const texto = textoDoRepasse(t.colega, t.pendencias);
  assert.match(texto, /^passou 2 pendência\(s\) à Dra\. Tereza: consulta no tribunal atrasada/);
  assert.ok(texto.length <= 300);
  const conv = conversaDeAcao({ id: 7, agente: 'carteira', texto });
  assert.strictEqual(conv.de, 'carteira');
  assert.strictEqual(conv.para, 'tribunais');
  assert.ok(conv.falas.length >= 2);
  assert.strictEqual(conv.falas[0].quem, 'carteira');
  assert.match(conv.falas[0].texto, /Tereza/);
  assert.strictEqual(conv.falas[1].quem, 'tribunais');
});

test('falas variam (não é sempre a mesma frase) e nunca expõem nome completo de cliente', () => {
  const variantes = new Set([1, 2, 3, 4, 5, 6].map((ref) => falasDoRepasse('tribunais', 2, 'consulta no tribunal atrasada', '0000001-11.2026.5.17.0001', ref)[0][1]));
  assert.ok(variantes.size >= 2);
  for (const colega of ['tribunais', 'prazos', 'leitor', 'estagiario', 'financeiro', 'secretaria']) {
    const f = falasDoRepasse(colega, 1, 'motivo', '0000001-11.2026.5.17.0001', 1);
    assert.ok(f.length >= 2, colega);
    assert.strictEqual(f[1][0], colega);
  }
});

test('o resumo do dia e as resolvidas viram conversa (com a Dra. Clara e a Dra. Tereza)', () => {
  const r = montarRaioX([proc({ ultimaMov: '2026-07-01' })], [], HOJE);
  const texto = textoDoRaioX(r);
  assert.match(texto, /^conferiu 1 processo\(s\) e 0 caso\(s\): 0 em dia; 1 pendência\(s\) — 0 crítica\(s\), 1 alta\(s\); saúde 0%$/);
  const c = conversaDeAcao({ id: 1, agente: 'carteira', texto });
  assert.strictEqual(c.para, 'secretaria');
  const c2 = conversaDeAcao({ id: 2, agente: 'carteira', texto: 'tirou 3 pendência(s) da lista: resolvidas desde ontem' });
  assert.strictEqual(c2.para, 'tribunais');
});

test('aviso à Dra.: só quando há grave nova/piorada, ou na segunda-feira; sem nome completo de cliente', () => {
  const r = montarRaioX([proc({ ultimaMov: '2026-07-01' })], [], HOJE); // alta
  const quinta = new Date('2026-11-19T10:00:00Z');
  const segunda = new Date('2026-11-23T10:00:00Z');
  const novo = avisoParaDra(r, compararComOntem(r.pendencias, []), quinta);
  assert.ok(novo);
  assert.match(novo.titulo, /Raio-x da carteira/);
  assert.match(novo.mensagem, /Saúde da carteira: 0%/);
  assert.match(novo.mensagem, /O que fazer/);
  assert.doesNotMatch(novo.mensagem, /Fictícia Souza/);
  const igual = compararComOntem(r.pendencias, r.pendencias);
  assert.strictEqual(avisoParaDra(r, igual, quinta), null);
  assert.ok(avisoParaDra(r, igual, segunda));
  const vazio = montarRaioX([proc()], [], HOJE);
  assert.strictEqual(avisoParaDra(vazio, compararComOntem([], []), segunda), null);
});

test('linha do briefing traz saúde, graves e os primeiros a resolver', () => {
  const r = montarRaioX([proc({ ultimaMov: '2026-07-01' })], [], HOJE);
  const b = resumoParaBriefing(r);
  assert.strictEqual(b.saude, 0);
  assert.strictEqual(b.graves, 1);
  assert.strictEqual(b.principais.length, 1);
  assert.match(b.principais[0], /0000001-11/);
});

// ── Ligação com o banco, o cron e a tela ─────────────────────────────────────
test('consultas do raio-x usam tabelas e colunas que existem nas migrations', () => {
  const arqs = ['src/services/carteiraRaioXJob.ts'].map((f) => path.resolve(f));
  const { tabelasInexistentes, colunasInexistentes, tabelasMortas } = auditarArquivos(arqs);
  assert.deepStrictEqual(tabelasInexistentes, []);
  assert.deepStrictEqual(colunasInexistentes, []);
  assert.deepStrictEqual(tabelasMortas, []);
});

test('raio-x agendado às 6h45 (antes do briefing) e é rotina do Dr. Vítor', () => {
  const crons = fs.readFileSync(path.resolve('src/crons/index.ts'), 'utf8');
  assert.match(crons, /cron\.schedule\('45 6 \* \* \*'[\s\S]{0,120}carteira:raio-x/);
  const vitor = AGENTES.find((a) => a.id === 'carteira');
  assert.ok(vitor.jobs.includes('carteira:raio-x'));
  assert.match(vitor.descricao, /repassa/);
});

test('job: repetir no mesmo dia não repete conversa nem aviso; nunca envia a cliente', () => {
  const job = fs.readFileSync(path.resolve('src/services/carteiraRaioXJob.ts'), 'utf8');
  assert.match(job, /if \(!jaHoje\)/);
  assert.doesNotMatch(job, /sendText|whatsapp/i);
});

test('ficha do Vítor mostra a pauta (rota /carteira e seção na tela)', () => {
  const rota = fs.readFileSync(path.resolve('src/routes/escritorio.ts'), 'utf8');
  assert.match(rota, /router\.get\('\/carteira'/);
  const tela = fs.readFileSync(path.resolve('public/escritorio.js'), 'utf8');
  assert.match(tela, /if \(id === 'carteira'\) corpo\.prepend\(await secaoCarteira\(\)\)/);
  assert.match(tela, /\/api\/escritorio\/carteira/);
});
