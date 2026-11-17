// tests/vencimentosEscritorio.test.mjs
// Pedido de 17/11/2026: "Não envie cobranças automáticas, quero receber lembretes
// de vencimentos no WhatsApp [...] e só pode enviar para o cliente se eu autorizar
// o envio da cobrança e sempre, sempre calcular os juros atualizados."
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  calcularEncargos, montarAvisoVencimentos, textoCobrancaCliente, ENCARGOS_CONTRATO,
} from '../dist/services/vencimentosEscritorio.js';

test('regra dos contratos: multa 2% e juros 1% ao mês pro rata die', () => {
  assert.equal(ENCARGOS_CONTRATO.multaPct, 2);
  assert.equal(ENCARGOS_CONTRATO.jurosMesPct, 1);
});

test('parcela de R$ 566,66 vencida em 16/11 calculada em 17/11 (1 dia)', () => {
  const e = calcularEncargos(566.66, '2026-11-16', '2026-11-17');
  assert.equal(e.diasAtraso, 1);
  assert.equal(e.multa, 11.33);
  assert.equal(e.juros, 0.19);
  assert.equal(e.total, 578.18);
});

test('30 dias de atraso: juros de um mês inteiro', () => {
  const e = calcularEncargos(1000, '2026-10-01', '2026-10-31');
  assert.equal(e.diasAtraso, 30);
  assert.equal(e.multa, 20);
  assert.equal(e.juros, 10);
  assert.equal(e.total, 1030);
});

test('não vencida (ou vence hoje): sem encargo nenhum', () => {
  for (const hoje of ['2026-11-16', '2026-11-10']) {
    const e = calcularEncargos(566.66, '2026-11-16', hoje);
    assert.equal(e.diasAtraso, 0);
    assert.equal(e.multa, 0);
    assert.equal(e.juros, 0);
    assert.equal(e.total, 566.66);
  }
});

test('aviso ao escritório separa vencidas (com valor atualizado), hoje e próximos dias', () => {
  const itens = [
    { cliente: 'Sandra Mara Peres Pereira', descricao: '2/4 — Honorários contratuais', valor: 566.66, vencimento: '2026-11-16' },
    { cliente: 'Fulano de Tal', descricao: '1ª parcela', valor: 300, vencimento: '2026-11-17' },
    { cliente: 'Beltrana', descricao: 'Consulta', valor: 200, vencimento: '2026-11-19' },
    { cliente: 'Longe', descricao: 'Futuro', valor: 50, vencimento: '2026-12-30' },
  ];
  const t = montarAvisoVencimentos(itens, '2026-11-17');
  assert.match(t, /17\/11\/2026/);
  assert.match(t, /Sandra Mara Peres Pereira/);
  assert.match(t, /16\/11\/2026/);           // data certa, sem voltar um dia pelo fuso
  assert.match(t, /R\$ 566,66 → R\$ 578,18/);
  assert.match(t, /Vencem hoje[\s\S]*Fulano/);
  assert.match(t, /Próximos 3 dias[\s\S]*Beltrana/);
  assert.doesNotMatch(t, /Longe/);
  assert.match(t, /Nada foi enviado ao cliente/);
});

test('sem nada vencendo, não manda aviso', () => {
  assert.equal(montarAvisoVencimentos([{ cliente: 'X', descricao: 'y', valor: 1, vencimento: '2027-05-01' }], '2026-11-17'), null);
});

test('texto da cobrança ao cliente traz o valor original, a multa, os juros e o total do dia', () => {
  const t = textoCobrancaCliente(
    { cliente: 'Sandra Mara Peres Pereira', descricao: '2/4 — Honorários contratuais', valor: 566.66, vencimento: '2026-11-16' },
    '2026-11-17');
  assert.match(t, /^Olá, Sandra!/);
  assert.match(t, /16\/11\/2026/);
  assert.match(t, /R\$ 566,66/);
  assert.match(t, /multa de 2%[^\n]*R\$ 11,33/);
  assert.match(t, /juros de 1% ao mês[^\n]*R\$ 0,19/);
  assert.match(t, /R\$ 578,18/);
  assert.match(t, /17\/11\/2026/);
});

test('cobrança ao cliente nunca sai sozinha: só rascunho para aprovar', () => {
  const src = fs.readFileSync(path.resolve('src/services/vencimentosEscritorio.ts'), 'utf8');
  assert.match(src, /prepararParaAprovacao/);
  // o único sendText é para o número do escritório
  const envios = src.split(/\r?\n/).filter((l) => /sendText\(/.test(l) && !/^\s*(\/\/|\*)/.test(l) && !/import /.test(l));
  assert.ok(envios.length >= 1);
  for (const l of envios) assert.match(l, /sendText\(\s*destino\b/);
});

test('régua automática de cobrança ao cliente está desligada (e-mail e WhatsApp)', () => {
  const crons = fs.readFileSync(path.resolve('src/crons/index.ts'), 'utf8');
  assert.doesNotMatch(crons, /sendBillingReminders/);
  assert.match(crons, /avisarVencimentosEscritorio/);
  const fila = fs.readFileSync(path.resolve('src/services/whatsappQueue.ts'), 'utf8');
  assert.doesNotMatch(fila, /context: 'cobranca'/);
  const envio = fs.readFileSync(path.resolve('src/services/uazapiInstance.ts'), 'utf8');
  assert.match(envio, /context <> 'cobranca'/);
});
