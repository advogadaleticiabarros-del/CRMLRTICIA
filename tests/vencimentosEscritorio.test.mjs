// tests/vencimentosEscritorio.test.mjs
// Pedido de 17/11/2026: "Não envie cobranças automáticas, quero receber lembretes
// de vencimentos no WhatsApp [...] e só pode enviar para o cliente se eu autorizar
// o envio da cobrança e sempre, sempre calcular os juros atualizados." E: "sempre
// calcule de acordo com cada contrato do cliente".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { montarAvisoVencimentos, textoCobrancaCliente, descreverRegra } from '../dist/services/vencimentosEscritorio.js';

const REGRA = { multaPct: 2, jurosMesPct: 1, ipca: true };
const IPCA = new Map([['2026-10', 0.14]]);
const SANDRA = { cliente: 'Sandra Mara Peres Pereira', descricao: '2/4 — Honorários contratuais', valor: 566.66, vencimento: '2026-11-16', regra: REGRA, contratoId: 12 };

test('regra descrita como está no contrato', () => {
  assert.equal(descreverRegra(REGRA), 'multa 2% + juros 1% a.m. + IPCA');
  assert.equal(descreverRegra({ multaPct: 10, jurosMesPct: 0.5, ipca: false }), 'multa 10% + juros 0,5% a.m.');
  assert.match(descreverRegra(null), /sem cláusula/);
});

test('aviso ao escritório: vencidas pelo contrato de cada cliente, hoje e próximos dias', () => {
  const itens = [
    SANDRA,
    { cliente: 'Sem Cláusula', descricao: 'Honorários', valor: 100, vencimento: '2026-11-10', regra: null, contratoId: 1 },
    { cliente: 'Fulano de Tal', descricao: '1ª parcela', valor: 300, vencimento: '2026-11-17' },
    { cliente: 'Beltrana', descricao: 'Consulta', valor: 200, vencimento: '2026-11-19' },
    { cliente: 'Longe', descricao: 'Futuro', valor: 50, vencimento: '2026-12-30' },
  ];
  const t = montarAvisoVencimentos(itens, '2026-11-17', IPCA);
  assert.match(t, /17\/11\/2026/);
  assert.match(t, /Sandra Mara Peres Pereira[^\n]*venceu 16\/11\/2026[^\n]*R\$ 566,66 → R\$ 578,21 \(multa 2% \+ juros 1% a\.m\. \+ IPCA\)/);
  assert.match(t, /Sem Cláusula[^\n]*R\$ 100,00 ⚠️ contrato sem cláusula/);
  assert.match(t, /1 sem cláusula de atraso/);
  assert.match(t, /Vencem hoje[\s\S]*Fulano/);
  assert.match(t, /Próximos 3 dias[\s\S]*Beltrana/);
  assert.doesNotMatch(t, /Longe/);
  assert.match(t, /Nada foi enviado ao cliente/);
});

test('IPCA fora do ar: aviso diz que a correção ficou de fora', () => {
  assert.match(montarAvisoVencimentos([SANDRA], '2026-11-17', null), /IPCA do Banco Central não respondeu/);
});

test('sem nada vencendo, não manda aviso', () => {
  assert.equal(montarAvisoVencimentos([{ cliente: 'X', descricao: 'y', valor: 1, vencimento: '2027-05-01' }], '2026-11-17'), null);
});

test('cobrança ao cliente traz parcela, IPCA, multa, juros e total do dia conforme o contrato', () => {
  const t = textoCobrancaCliente(SANDRA, '2026-11-17', IPCA);
  assert.match(t, /^Olá, Sandra!/);
  assert.match(t, /16\/11\/2026/);
  assert.match(t, /• Parcela: R\$ 566,66/);
  assert.match(t, /correção pelo IPCA \(1 dia\): R\$ 0,03/);
  assert.match(t, /multa de 2%: R\$ 11,33/);
  assert.match(t, /juros de 1% ao mês \(1 dia\): R\$ 0,19/);
  assert.match(t, /Total: R\$ 578,21/);
});

test('contrato sem IPCA não mostra linha de correção; sem cláusula não mostra encargo', () => {
  const semIpca = textoCobrancaCliente({ ...SANDRA, regra: { multaPct: 2, jurosMesPct: 1, ipca: false } }, '2026-11-17', IPCA);
  assert.doesNotMatch(semIpca, /IPCA/);
  assert.match(semIpca, /Total: R\$ 578,18/);
  const sem = textoCobrancaCliente({ ...SANDRA, regra: null }, '2026-11-17', IPCA);
  assert.doesNotMatch(sem, /multa|juros|Total/);
  assert.match(sem, /R\$ 566,66/);
});

test('cobrança ao cliente nunca sai sozinha: só rascunho para aprovar', () => {
  const src = fs.readFileSync(path.resolve('src/services/vencimentosEscritorio.ts'), 'utf8');
  assert.match(src, /prepararParaAprovacao/);
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

test('portal do cliente calcula pelo contrato, não pelas Configurações', () => {
  const src = fs.readFileSync(path.resolve('src/routes/portal.ts'), 'utf8');
  assert.match(src, /regraDoCliente/);
  assert.doesNotMatch(src, /multa_percent|juros_mes_percent/);
});
