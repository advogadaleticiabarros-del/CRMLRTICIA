// Aviso de queda da conexão com o Google — 18/11/2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ehQuedaDeAutorizacaoGoogle, avisarQuedaConexaoGoogle } from '../dist/services/avisoConexaoGoogle.js';

test('reconhece o erro de autorização revogada do Google', () => {
  assert.equal(ehQuedaDeAutorizacaoGoogle('invalid_grant'), true);
  assert.equal(ehQuedaDeAutorizacaoGoogle('Token has been expired or revoked.'), true);
  assert.equal(ehQuedaDeAutorizacaoGoogle('ETIMEDOUT'), false);
  assert.equal(ehQuedaDeAutorizacaoGoogle(''), false);
});

function deps(ultimoAvisoHorasAtras) {
  const enviados = [];
  const registrados = [];
  return {
    enviados, registrados,
    d: {
      horasDesdeUltimoAviso: async () => ultimoAvisoHorasAtras,
      enviarWhatsapp: async (texto) => { enviados.push(texto); return true; },
      registrarAviso: async (texto) => { registrados.push(texto); },
    },
  };
}

test('avisa no WhatsApp com o que parou e onde reconectar', async () => {
  const { d, enviados, registrados } = deps(null);
  const r = await avisarQuedaConexaoGoogle('monitoramento:processos-email', d);
  assert.equal(r, 'avisado');
  assert.equal(enviados.length, 1);
  assert.match(enviados[0], /Push do TRT17/);
  assert.match(enviados[0], /Reconectar/);
  assert.equal(registrados.length, 1);
});

test('cada rotina diz o que parou', async () => {
  const a = deps(null); await avisarQuedaConexaoGoogle('agenda:sync-incremental', a.d);
  assert.match(a.enviados[0], /Agenda/);
  const p = deps(null); await avisarQuedaConexaoGoogle('parceria:sync-gmail', p.d);
  assert.match(p.enviados[0], /parceira/i);
});

test('não repete o aviso antes de 24 horas', async () => {
  const { d, enviados } = deps(5);
  assert.equal(await avisarQuedaConexaoGoogle('agenda:sync-incremental', d), 'ja_avisado');
  assert.equal(enviados.length, 0);
  const depois = deps(25);
  assert.equal(await avisarQuedaConexaoGoogle('agenda:sync-incremental', depois.d), 'avisado');
});

test('rotina que não usa o Google não gera aviso', async () => {
  const { d, enviados } = deps(null);
  assert.equal(await avisarQuedaConexaoGoogle('backup:diario', d), 'nao_se_aplica');
  assert.equal(enviados.length, 0);
});
