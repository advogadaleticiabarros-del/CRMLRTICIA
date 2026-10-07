// tests/briefingAudiencia.test.mjs — briefing da véspera da audiência trabalhista
import { test } from 'node:test';
import assert from 'node:assert';
import { ehAudienciaTrabalhista, selecionarDocumentos, montarInstrucao, dividirMensagem, janelaDeAmanha } from '../dist/services/briefingAudienciaRegras.js';

test('ehAudienciaTrabalhista: área trabalhista ou processo da Justiça do Trabalho (segmento 5)', () => {
  assert.strictEqual(ehAudienciaTrabalhista({ legal_area: 'trabalhista', case_number: null }), true);
  assert.strictEqual(ehAudienciaTrabalhista({ legal_area: null, case_number: '0000328-18.2025.5.17.0013' }), true);
  assert.strictEqual(ehAudienciaTrabalhista({ legal_area: 'consumidor', case_number: '5003024-88.2026.8.08.0050' }), false);
  assert.strictEqual(ehAudienciaTrabalhista({ legal_area: 'previdenciario', case_number: '5022221-18.2026.4.02.5001' }), false);
});

test('selecionarDocumentos: prioriza inicial, contestação, autos e atas; respeita o limite de tamanho', () => {
  const docs = [
    { id: 1, name: 'Comprovante de residência', mime: 'application/pdf', bytes: 300_000 },
    { id: 2, name: 'Contestação da reclamada', mime: 'application/pdf', bytes: 2_000_000 },
    { id: 3, name: 'Petição inicial', mime: 'application/pdf', bytes: 1_000_000 },
    { id: 4, name: 'Foto do cartão de ponto', mime: 'image/jpeg', bytes: 500_000 },
    { id: 5, name: 'Autos completos', mime: 'application/pdf', bytes: 9_000_000 },
    { id: 6, name: 'Planilha.xlsx', mime: 'application/vnd.ms-excel', bytes: 10_000 },
  ];
  const r = selecionarDocumentos(docs, 12_500_000);
  assert.deepStrictEqual(r.escolhidos.map((d) => d.id), [3, 2, 5, 4]);
  assert.deepStrictEqual(r.deFora.map((d) => d.id).sort(), [1, 6]);
});

test('montarInstrucao: só as fontes do caso, seções pedidas e marcação do que precisa confirmar', () => {
  const t = montarInstrucao({ cliente: 'Kemilly', processo: '0000328-18.2025.5.17.0013', quando: '08/10/2026 às 13:00', polo: 'ativo', contexto: 'MOVIMENTAÇÕES...' });
  for (const sec of ['FATOS CENTRAIS', 'PEDIDOS', 'PROVAS E DOCUMENTOS-CHAVE', 'PERGUNTAS', 'RISCOS', 'PONTOS CONTROVERTIDOS', 'PROVIDÊNCIAS PENDENTES'])
    assert.match(t, new RegExp(sec), sec);
  assert.match(t, /APENAS/);
  assert.match(t, /⚠️ CONFIRMAR/);
  assert.match(t, /reclamante/i);
  assert.match(t, /CONCISO/);
});

test('montarInstrucao: na defesa (cliente reclamada) as perguntas mudam de lado', () => {
  assert.match(montarInstrucao({ cliente: 'Stilo Pet', processo: 'x', quando: 'y', polo: 'passivo', contexto: '' }), /RECLAMADA/);
});

test('dividirMensagem: corta em partes sem quebrar no meio da linha', () => {
  const texto = Array.from({ length: 200 }, (_, i) => `Linha ${i} com algum conteúdo do briefing`).join('\n');
  const partes = dividirMensagem(texto, 1500);
  assert.ok(partes.length > 1);
  assert.ok(partes.every((p) => p.length <= 1500 + 20));
  assert.strictEqual(partes.join('\n').replace(/\n?\(continua\)\n?/g, '\n').split('\n').filter(Boolean).length, 200);
});

test('janelaDeAmanha: dia seguinte inteiro no horário de Brasília, em UTC', () => {
  const j = janelaDeAmanha(new Date('2026-10-07T21:30:00Z')); // 18h30 de 07/10 em Brasília
  assert.strictEqual(j.inicio.toISOString(), '2026-10-08T03:00:00.000Z');
  assert.strictEqual(j.fim.toISOString(), '2026-10-09T03:00:00.000Z');
});
