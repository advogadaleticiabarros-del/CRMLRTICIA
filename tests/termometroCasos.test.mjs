// Termômetro dos casos — 18/11/2026. Números e nomes FICTÍCIOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sistemaDoProcesso, faixaDeDias, montarTermometro } from '../dist/services/termometroCasos.js';

const HOJE = new Date('2026-11-18T12:00:00Z');
const TJES = '5000001-11.2026.8.08.0024';
const TJES_2G = '5000002-22.2026.8.08.0000';
const JFES = '5000003-33.2026.4.02.5001';
const TRT17 = '0000004-44.2026.5.17.0001';
const TRT9 = '0000005-55.2026.5.09.0021';
const TJMG = '5000006-66.2026.8.13.0024';

test('sistema pelo número: TJES 1º e 2º grau, eproc, TRT17 e de fora', () => {
  assert.deepEqual(sistemaDoProcesso(TJES), { id: 'tjes_pje1g', nome: 'TJES — PJe 1º grau', ligavel: true });
  assert.equal(sistemaDoProcesso(TJES_2G).id, 'tjes_pje2g');
  assert.equal(sistemaDoProcesso(JFES).id, 'eproc_jfes');
  assert.equal(sistemaDoProcesso(TRT17).id, 'trt17');
  assert.equal(sistemaDoProcesso(TRT17).ligavel, false);
  assert.equal(sistemaDoProcesso(TRT9).nome, 'TRT da 9ª Região');
  assert.equal(sistemaDoProcesso(TJMG).nome, 'Tribunal de Justiça (fora do ES, código 13)');
  assert.equal(sistemaDoProcesso('123').id, 'sem_numero');
});

test('faixa por dias parados', () => {
  assert.equal(faixaDeDias(null), 'sem_movimento');
  assert.equal(faixaDeDias(0), 'em_dia');
  assert.equal(faixaDeDias(30), 'em_dia');
  assert.equal(faixaDeDias(31), 'atencao');
  assert.equal(faixaDeDias(60), 'atencao');
  assert.equal(faixaDeDias(61), 'alerta');
  assert.equal(faixaDeDias(100), 'alerta');
  assert.equal(faixaDeDias(101), 'parado');
});

const proc = (o) => ({ id: 1, process_number: TJES, client_name: 'Cliente Exemplo', phase: 'instrucao', suggested_phase: null,
  status: 'ativo', ultimo_movimento_em: '2026-11-10T10:00:00Z', ultimo_titulo: 'Juntada', court: 'Vara X', case_id: null, client_id: 1, ...o });

test('termômetro: dias, faixas, encerrados fora, fase a conferir e login que falta', () => {
  const t = montarTermometro([
    proc({ id: 1 }),                                                         // 8 dias, em dia
    proc({ id: 2, ultimo_movimento_em: '2026-07-01T10:00:00Z', process_number: JFES }), // 140 dias, parado
    proc({ id: 3, ultimo_movimento_em: null, process_number: TRT17 }),       // sem movimento
    proc({ id: 4, phase: 'encerrado' }),                                     // fora
    proc({ id: 5, status: 'arquivado' }),                                    // fora
    proc({ id: 6, suggested_phase: 'recurso', process_number: TJES_2G, ultimo_movimento_em: '2026-09-01T10:00:00Z' }), // 78 dias
  ], ['tjes_pje1g'], HOJE);

  assert.equal(t.total_ativos, 4);
  assert.equal(t.encerrados, 2);
  assert.deepEqual(t.por_faixa, { em_dia: 1, atencao: 0, alerta: 1, parado: 1, sem_movimento: 1 });
  assert.equal(t.processos[0].id, 3, 'sem movimento vem primeiro');
  assert.equal(t.processos[1].id, 2, 'depois o mais parado');
  assert.equal(t.processos.find((p) => p.id === 2).dias_parado, 140);
  assert.equal(t.processos.find((p) => p.id === 6).fase_a_conferir, true);
  assert.equal(t.processos.find((p) => p.id === 1).fase_a_conferir, false);
  assert.equal(t.parados_100, 1);
  assert.deepEqual(t.por_fase.instrucao, 4);
  // temperatura = % dos ativos com movimento nos últimos 60 dias
  assert.equal(t.temperatura, 25);

  const logins = Object.fromEntries(t.logins.map((l) => [l.id, l]));
  assert.equal(logins.tjes_pje1g.situacao, 'ligado');
  assert.equal(logins.tjes_pje2g.situacao, 'falta_login');
  assert.equal(logins.eproc_jfes.situacao, 'falta_login');
  assert.equal(logins.eproc_jfes.processos, 1);
  assert.equal(logins.trt17.situacao, 'credenciamento');
  assert.equal(t.processos.find((p) => p.id === 2).sistema.situacao, 'falta_login');
});
