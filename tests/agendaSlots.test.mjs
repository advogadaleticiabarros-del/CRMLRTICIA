// tests/agendaSlots.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularSlotsDisponiveis, parseExpedienteDeOfficeSettings } from '../dist/services/agendaSlots.js';

const expedientePadrao = {
  diasSemana: [1, 2, 3, 4, 5], // seg-sex
  horaInicio: '09:00',
  horaFim: '12:00', // janela curta pra testes previsíveis: 09,10,11 (3 slots de 60min)
  duracaoConsultaMin: 60,
};

test('dia fora do expediente configurado não gera slots', () => {
  // 2026-08-30 é domingo — fora de [1..5]
  const slots = calcularSlotsDisponiveis(expedientePadrao, [], '2026-08-30', '2026-08-30', '2026-08-01T00:00');
  assert.deepEqual(slots, []);
});

test('dia dentro do expediente gera os slots esperados sem eventos', () => {
  // 2026-08-24 é segunda-feira
  const slots = calcularSlotsDisponiveis(expedientePadrao, [], '2026-08-24', '2026-08-24', '2026-08-01T00:00');
  assert.deepEqual(slots, [
    { start_datetime: '2026-08-24T09:00', end_datetime: '2026-08-24T10:00' },
    { start_datetime: '2026-08-24T10:00', end_datetime: '2026-08-24T11:00' },
    { start_datetime: '2026-08-24T11:00', end_datetime: '2026-08-24T12:00' },
  ]);
});

test('um evento existente remove exatamente o slot que colide, sem afetar vizinhos', () => {
  const eventos = [{ start_datetime: '2026-08-24T10:00', end_datetime: '2026-08-24T11:00' }];
  const slots = calcularSlotsDisponiveis(expedientePadrao, eventos, '2026-08-24', '2026-08-24', '2026-08-01T00:00');
  assert.deepEqual(slots, [
    { start_datetime: '2026-08-24T09:00', end_datetime: '2026-08-24T10:00' },
    { start_datetime: '2026-08-24T11:00', end_datetime: '2026-08-24T12:00' },
  ]);
});

test('evento com sobreposição parcial (não alinhado ao slot) também bloqueia o slot inteiro', () => {
  // Evento das 10:30 às 11:30 sobrepõe parcialmente os slots 10:00-11:00 e 11:00-12:00
  const eventos = [{ start_datetime: '2026-08-24T10:30', end_datetime: '2026-08-24T11:30' }];
  const slots = calcularSlotsDisponiveis(expedientePadrao, eventos, '2026-08-24', '2026-08-24', '2026-08-01T00:00');
  assert.deepEqual(slots, [
    { start_datetime: '2026-08-24T09:00', end_datetime: '2026-08-24T10:00' },
  ]);
});

test('dois eventos adjacentes sem gap não geram um slot encaixado entre eles se a duração não cabe', () => {
  // Eventos ocupam 09:00-10:00 e 10:00-11:00 — não sobra espaço de 60min
  // entre eles nem depois, só o slot 11:00-12:00 remanescente.
  const eventos = [
    { start_datetime: '2026-08-24T09:00', end_datetime: '2026-08-24T10:00' },
    { start_datetime: '2026-08-24T10:00', end_datetime: '2026-08-24T11:00' },
  ];
  const slots = calcularSlotsDisponiveis(expedientePadrao, eventos, '2026-08-24', '2026-08-24', '2026-08-01T00:00');
  assert.deepEqual(slots, [
    { start_datetime: '2026-08-24T11:00', end_datetime: '2026-08-24T12:00' },
  ]);
});

test('janela de busca maior que os dados de eventosExistentes gera slots normalmente nos dias sem evento', () => {
  // eventosExistentes só cobre 24/08; 25/08 (terça) deve sair livre e completo
  const eventos = [{ start_datetime: '2026-08-24T09:00', end_datetime: '2026-08-24T12:00' }];
  const slots = calcularSlotsDisponiveis(expedientePadrao, eventos, '2026-08-24', '2026-08-25', '2026-08-01T00:00');
  assert.deepEqual(slots, [
    { start_datetime: '2026-08-25T09:00', end_datetime: '2026-08-25T10:00' },
    { start_datetime: '2026-08-25T10:00', end_datetime: '2026-08-25T11:00' },
    { start_datetime: '2026-08-25T11:00', end_datetime: '2026-08-25T12:00' },
  ]);
});

test('slot de hoje que já passou não é sugerido (regressão: sugeria 9h mesmo já sendo 18h)', () => {
  // "agora" = 24/08 18:30 — o expediente do dia (09h-12h) já passou inteiro
  const slots = calcularSlotsDisponiveis(expedientePadrao, [], '2026-08-24', '2026-08-25', '2026-08-24T18:30');
  assert.deepEqual(slots, [
    { start_datetime: '2026-08-25T09:00', end_datetime: '2026-08-25T10:00' },
    { start_datetime: '2026-08-25T10:00', end_datetime: '2026-08-25T11:00' },
    { start_datetime: '2026-08-25T11:00', end_datetime: '2026-08-25T12:00' },
  ]);
});

test('slot de hoje ainda não passado continua aparecendo', () => {
  // "agora" = 24/08 09:30 — o slot das 09h já passou, mas 10h e 11h ainda não
  const slots = calcularSlotsDisponiveis(expedientePadrao, [], '2026-08-24', '2026-08-24', '2026-08-24T09:30');
  assert.deepEqual(slots, [
    { start_datetime: '2026-08-24T10:00', end_datetime: '2026-08-24T11:00' },
    { start_datetime: '2026-08-24T11:00', end_datetime: '2026-08-24T12:00' },
  ]);
});

test('parseExpedienteDeOfficeSettings aplica defaults quando settings vem vazio', () => {
  const expediente = parseExpedienteDeOfficeSettings({});
  assert.deepEqual(expediente, {
    diasSemana: [1, 2, 3, 4, 5],
    horaInicio: '09:00',
    horaFim: '18:00',
    duracaoConsultaMin: 60,
  });
});

test('parseExpedienteDeOfficeSettings lê os valores configurados', () => {
  const expediente = parseExpedienteDeOfficeSettings({
    agenda_dias_semana: '1,3,5',
    agenda_hora_inicio: '08:00',
    agenda_hora_fim: '14:00',
    agenda_duracao_consulta_min: '30',
  });
  assert.deepEqual(expediente, {
    diasSemana: [1, 3, 5],
    horaInicio: '08:00',
    horaFim: '14:00',
    duracaoConsultaMin: 30,
  });
});
