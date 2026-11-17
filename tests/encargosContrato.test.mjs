// tests/encargosContrato.test.mjs
// Pedido de 17/11/2026: "sempre calcule de acordo com cada contrato do cliente".
// Multa, juros e correção saem da cláusula de inadimplemento do contrato daquele
// cliente; sem cláusula, não há encargo (e a equipe é avisada).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lerClausulaAtraso, calcularEncargos, escolherContrato, serieIpca,
} from '../dist/services/encargosContrato.js';

const MODELO_ATUAL = `CLÁUSULA QUINTA - DO INADIMPLEMENTO
**5.1.** O atraso no pagamento de qualquer valor devido à CONTRATADA acarretará, independentemente de notificação judicial ou extrajudicial:
a) multa moratória de 2% (dois por cento) sobre o valor em atraso;
b) juros de mora de 1% (um por cento) ao mês, calculados proporcionalmente aos dias de atraso;
c) correção monetária pelo IPCA, ou por outro índice oficial que venha a substituí-lo.`;

const MODELO_CORRIDO = `<p>O atraso ou a falta de pagamento de qualquer parcela dos honorários advocatícios na data de seu vencimento acarretará, independentemente de aviso, a incidência de multa moratória de 2% (dois por cento) sobre o valor da parcela em atraso, juros de mora de 1% (um por cento) ao mês, calculados pro rata die, e correção monetária pelo IPCA.</p>
<p>PARÁGRAFO SEGUNDO - [...] b) incidência de multa não compensatória no valor de 20% (vinte por cento) sobre o valor atualizado da causa.</p>`;

const SO_AUDIENCIA = `O não comparecimento injustificado resultará na aplicação de multa não compensatória no valor de 20% (vinte por cento) sobre o valor atualizado da causa. Multa contratual no valor de R$ 1.000,00 (mil reais).`;

test('lê multa, juros e IPCA do modelo atual (itens a, b, c)', () => {
  assert.deepEqual(lerClausulaAtraso(MODELO_ATUAL), { multaPct: 2, jurosMesPct: 1, ipca: true });
});

test('lê o modelo em parágrafo corrido e ignora a multa de 20% por falta à audiência', () => {
  assert.deepEqual(lerClausulaAtraso(MODELO_CORRIDO), { multaPct: 2, jurosMesPct: 1, ipca: true });
});

test('contrato sem cláusula de atraso: sem regra (nunca usa a multa de audiência)', () => {
  assert.equal(lerClausulaAtraso(SO_AUDIENCIA), null);
  assert.equal(lerClausulaAtraso(''), null);
});

test('percentuais diferentes e com vírgula são respeitados', () => {
  const t = 'multa moratória de 10% sobre o valor em atraso e juros de mora de 0,5% (meio por cento) ao mês';
  assert.deepEqual(lerClausulaAtraso(t), { multaPct: 10, jurosMesPct: 0.5, ipca: false });
});

test('IPCA vem da mesma fonte do Calculista (indices_economicos), em mapa AAAA-MM → %', async () => {
  const m = await serieIpca(async () => ({ indices: { ipca: { '2026-09': 0.82, '2026-10': 0.14 } } }));
  assert.equal(m.get('2026-09'), 0.82);
  assert.equal(m.get('2026-10'), 0.14);
});

const IPCA = new Map([['2026-09', 0.82], ['2026-10', 0.14]]);
const REGRA = { multaPct: 2, jurosMesPct: 1, ipca: true };

test('Sandra: R$ 566,66 vencida em 16/11, em 17/11, com IPCA do último mês publicado', () => {
  const e = calcularEncargos(566.66, '2026-11-16', '2026-11-17', REGRA, IPCA);
  assert.equal(e.diasAtraso, 1);
  assert.equal(e.correcao, 0.03);
  assert.equal(e.multa, 11.33);
  assert.equal(e.juros, 0.19);
  assert.equal(e.total, 578.21);
  assert.equal(e.ipcaEstimado, true); // novembro ainda não publicado
});

test('IPCA pro rata die: mês inteiro de outubro aplica 0,14% cheio', () => {
  const e = calcularEncargos(1000, '2026-09-30', '2026-10-31', { multaPct: 0, jurosMesPct: 0, ipca: true }, IPCA);
  assert.equal(e.diasAtraso, 31);
  assert.equal(e.correcao, 1.4);
  assert.equal(e.ipcaEstimado, false);
});

test('deflação não reduz o valor original', () => {
  const e = calcularEncargos(1000, '2026-07-31', '2026-08-31', { multaPct: 0, jurosMesPct: 0, ipca: true }, new Map([['2026-08', -0.32]]));
  assert.equal(e.correcao, 0);
  assert.equal(e.total, 1000);
});

test('multa e juros incidem sobre o valor corrigido', () => {
  const e = calcularEncargos(1000, '2026-09-30', '2026-10-30', REGRA, IPCA);
  // 30 dias de outubro: fator (1,0014)^(30/31)
  const corr = 1000 * (Math.pow(1.0014, 30 / 31) - 1);
  assert.equal(e.correcao, Math.round(corr * 100) / 100);
  assert.equal(e.multa, Math.round((1000 + corr) * 0.02 * 100) / 100);
  assert.equal(e.juros, Math.round((1000 + corr) * 0.01 * 100) / 100);
});

test('sem regra (contrato sem cláusula): nenhum encargo', () => {
  const e = calcularEncargos(566.66, '2026-10-16', '2026-11-17', null, IPCA);
  assert.equal(e.total, 566.66);
  assert.equal(e.multa, 0);
  assert.equal(e.juros, 0);
  assert.equal(e.correcao, 0);
});

test('contrato sem IPCA na cláusula: só multa e juros', () => {
  const e = calcularEncargos(566.66, '2026-11-16', '2026-11-17', { multaPct: 2, jurosMesPct: 1, ipca: false }, IPCA);
  assert.equal(e.correcao, 0);
  assert.equal(e.total, 578.18);
});

test('IPCA indisponível: calcula multa e juros e avisa que a correção ficou de fora', () => {
  const e = calcularEncargos(566.66, '2026-11-16', '2026-11-17', REGRA, null);
  assert.equal(e.correcao, 0);
  assert.equal(e.total, 578.18);
  assert.equal(e.ipcaIndisponivel, true);
});

test('escolhe o contrato: assinado antes de enviado; com valor igual à receita; depois o mais recente', () => {
  const cs = [
    { id: 1, status: 'enviado_assinatura', value: 2500, created_at: '2026-11-10' },
    { id: 2, status: 'assinado', value: 3000, created_at: '2026-10-01' },
    { id: 3, status: 'assinado', value: 2500, created_at: '2026-09-01' },
    { id: 4, status: 'cancelado', value: 2500, created_at: '2026-11-12' },
  ];
  assert.equal(escolherContrato(cs, 2500)?.id, 3);
  assert.equal(escolherContrato(cs, 999)?.id, 2);
  assert.equal(escolherContrato(cs)?.id, 2);
  assert.equal(escolherContrato([{ id: 9, status: 'enviado_assinatura', value: 1, created_at: '2026-01-01' }])?.id, 9);
  assert.equal(escolherContrato([{ id: 4, status: 'cancelado', value: 1, created_at: '2026-01-01' }]), null);
});
