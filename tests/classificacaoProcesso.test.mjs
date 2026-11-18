// Classificação do processo: justiça, instância, área e temperatura pelas decisões — 18/11/2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  justicaPeloNumero, instanciaMaisAlta, areaPeloProcesso, efeitoDaMovimentacao, temperaturaPelasDecisoes,
} from '../dist/services/classificacaoProcesso.js';

test('justiça pelo número CNJ', () => {
  assert.equal(justicaPeloNumero('5000001-11.2026.8.08.0024'), 'estadual');
  assert.equal(justicaPeloNumero('5000001-11.2026.4.02.5001'), 'federal');
  assert.equal(justicaPeloNumero('0001075-67.2026.5.17.0001'), 'trabalho');
  assert.equal(justicaPeloNumero('123'), null);
});

test('instância: o grau mais alto em que o processo aparece', () => {
  assert.equal(instanciaMaisAlta(['JE']), 'juizado');
  assert.equal(instanciaMaisAlta(['JE', 'TR']), 'turma_recursal');
  assert.equal(instanciaMaisAlta(['G1', 'G2']), '2grau');
  assert.equal(instanciaMaisAlta([null, 'XX']), null);
});

test('área pela justiça, classe e assuntos', () => {
  assert.equal(areaPeloProcesso({ justica: 'trabalho', classe: 'Ação Trabalhista - Rito Ordinário' }), 'trabalhista');
  assert.equal(areaPeloProcesso({ justica: 'federal', classe: 'Procedimento do Juizado Especial Cível', assuntos: ['Auxílio-Doença Previdenciário'] }), 'previdenciario');
  assert.equal(areaPeloProcesso({ justica: 'estadual', classe: 'Procedimento do Juizado Especial Cível', assuntos: ['Empréstimo consignado'] }), 'consumidor');
  assert.equal(areaPeloProcesso({ justica: 'estadual', classe: 'Alimentos - Lei Especial Nº 5.478/68' }), 'familia');
  assert.equal(areaPeloProcesso({ justica: 'estadual', classe: 'Procedimento Comum Cível', assuntos: ['Indenização por Dano Moral'] }), 'civel');
  assert.equal(areaPeloProcesso({ justica: 'estadual', classe: '', assuntos: [] }), null);
});

test('efeito das movimentações reais (nomes da TPU)', () => {
  assert.equal(efeitoDaMovimentacao('Procedência em Parte'), 'favor');
  assert.equal(efeitoDaMovimentacao('Procedência do pedido e improcedência do pedido contraposto'), 'favor');
  assert.equal(efeitoDaMovimentacao('Improcedência'), 'contra');
  assert.equal(efeitoDaMovimentacao('Homologação de Transação'), 'favor');
  assert.equal(efeitoDaMovimentacao('Inadmissibilidade do procedimento sumaríssimo'), 'contra');
  assert.equal(efeitoDaMovimentacao('TR — Não-Provimento'), 'recurso_nao_provido');
  assert.equal(efeitoDaMovimentacao('2º grau — Provimento em Parte'), 'recurso_parcial');
  assert.equal(efeitoDaMovimentacao('Provimento'), 'recurso_provido');
  // Nome igual para concedida e negada: não conta.
  assert.equal(efeitoDaMovimentacao('Antecipação de tutela'), null);
  assert.equal(efeitoDaMovimentacao('Homologação de Decisão de Juiz Leigo'), null);
  assert.equal(efeitoDaMovimentacao('Trânsito em julgado'), null);
});

const m = (d, t) => ({ movement_date: d, title: t });

test('temperatura: sem decisão é morno', () => {
  const r = temperaturaPelasDecisoes([m('2026-01-10', 'Distribuído'), m('2026-02-01', 'Antecipação de tutela')], 'ativo');
  assert.equal(r.temperatura, 'morno');
});

test('temperatura: procedência para autora é quente; para ré é frio', () => {
  const movs = [m('2026-03-01', 'Procedência em Parte'), m('2026-04-01', 'Trânsito em julgado')];
  assert.equal(temperaturaPelasDecisoes(movs, 'ativo').temperatura, 'quente');
  assert.equal(temperaturaPelasDecisoes(movs, 'ativo').confianca, 'alta');
  assert.equal(temperaturaPelasDecisoes(movs, 'passivo').temperatura, 'frio');
});

test('temperatura: recurso — provido inverte, não provido mantém (confiança média)', () => {
  const ganhou = [m('2026-03-01', 'Procedência'), m('2026-06-01', 'TR — Provimento')];
  assert.equal(temperaturaPelasDecisoes(ganhou, 'ativo').temperatura, 'frio');
  assert.equal(temperaturaPelasDecisoes(ganhou, 'ativo').confianca, 'media');
  const perdeu = [m('2026-03-01', 'Improcedência'), m('2026-06-01', 'TR — Não-Provimento')];
  assert.equal(temperaturaPelasDecisoes(perdeu, 'ativo').temperatura, 'frio');
  const virou = [m('2026-03-01', 'Improcedência'), m('2026-06-01', 'Provimento')];
  assert.equal(temperaturaPelasDecisoes(virou, 'ativo').temperatura, 'quente');
});

test('temperatura: recurso sem sentença conhecida fica morno; ordem é pela data', () => {
  assert.equal(temperaturaPelasDecisoes([m('2026-06-01', 'Provimento')], 'ativo').temperatura, 'morno');
  const fora = [m('2026-06-01', 'Procedência'), m('2026-03-01', 'Improcedência')];
  assert.equal(temperaturaPelasDecisoes(fora, 'ativo').temperatura, 'quente');
  assert.equal(temperaturaPelasDecisoes(fora, null).confianca, 'media');
});
