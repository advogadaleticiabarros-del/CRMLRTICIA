// tests/contabilista.test.mjs — Calculista na leitura dos documentos (31/10/2026).
// O histórico de créditos do INSS (HISCRE) mostra cada desconto só pela rubrica
// ("216 CONSIGNACAO EMPRESTIMO BANCARIO 43,64"), sem banco nem contrato. O extrato de
// empréstimos (HISCON) traz os contratos com banco, parcela e período. O Calculista
// cruza os dois em código: cada desconto vai para o contrato certo (e o banco certo),
// e só os meses que o extrato não cobre são estimados pela parcela.
// Caso real (Valmirio, Itaú): os descontos sem banco eram descartados e a peça saía com R$ 0,00.
import { test } from 'node:test';
import assert from 'node:assert';
import { apurarDescontos, familiaDaRubrica, apurarFicha } from '../dist/services/contabilista.js';
import { parseFichaDeFatos } from '../dist/services/pecaDossie.js';

const HOJE = new Date(2026, 9, 31); // 31/10/2026

const contrato = (o) => ({
  numero: null, tipo: 'emprestimo_consignado', banco: null, data: null, valor_liberado: null, parcela: null, n_parcelas: null,
  parcelas_pagas: null, taxa_mensal: null, taxa_media_mercado: null, inicio_desconto: null, fim_desconto: null, situacao: 'ativo', fonte: 'HISCON.pdf', ...o,
});
const ITAU = contrato({ numero: '632706066', banco: 'Banco Itaú S.A.', parcela: 43.64, n_parcelas: 84, inicio_desconto: '2022-01' });
const PAN = contrato({ numero: '0099887', banco: 'Banco Pan S.A.', parcela: 120.5, n_parcelas: 84, inicio_desconto: '2021-06' });
const FACTA_RMC = contrato({ numero: 'RMC-55', tipo: 'rmc', banco: 'Facta Financeira S.A.', inicio_desconto: '2020-03' });

const meses = (de, ate) => { const out = []; let [a, m] = de.split('-').map(Number); for (;;) { const c = `${a}-${String(m).padStart(2, '0')}`; if (c > ate) break; out.push(c); m++; if (m > 12) { m = 1; a++; } } return out; };
const lanc = (competencia, valor, rubrica) => ({ competencia, valor, rubrica, contrato: null, banco: null, fonte: 'HISCRE.pdf' });

test('familiaDaRubrica: 216 é empréstimo; 217/RMC é cartão RMC; 268/RCC é cartão RCC; o resto não é de banco', () => {
  assert.strictEqual(familiaDaRubrica('216 CONSIGNACAO EMPRESTIMO BANCARIO'), 'emprestimo');
  assert.strictEqual(familiaDaRubrica('217 EMPRESTIMO SOBRE A RMC'), 'rmc');
  assert.strictEqual(familiaDaRubrica('268 CONSIGNACAO - CARTAO'), 'rcc');
  assert.strictEqual(familiaDaRubrica('RCC - reserva de cartão consignado de benefício'), 'rcc');
  assert.strictEqual(familiaDaRubrica('203 IMPOSTO DE RENDA RETIDO NA FONTE'), null);
  assert.strictEqual(familiaDaRubrica(null), null);
});

test('apurarDescontos: cada desconto do HISCRE vai para o contrato do HISCON pelo valor da parcela e pelo período', () => {
  const lancamentos = [
    ...meses('2022-01', '2022-03').map((c) => lanc(c, 43.64, '216 CONSIGNACAO EMPRESTIMO BANCARIO')),
    ...meses('2022-01', '2022-03').map((c) => lanc(c, 120.5, '216 CONSIGNACAO EMPRESTIMO BANCARIO')),
    ...meses('2022-01', '2022-03').map((c, i) => lanc(c, 60 + i, '217 EMPRESTIMO SOBRE A RMC')),
  ];
  const r = apurarDescontos({ contratos: [ITAU, PAN, FACTA_RMC], lancamentos, competenciasExtrato: meses('2022-01', '2022-03'), hoje: new Date(2022, 3, 10) });
  const de = (n) => r.descontos.filter((d) => d.contrato === n);
  assert.deepStrictEqual(de('632706066').map((d) => [d.competencia, d.valor, d.origem]), [['2022-01', 43.64, 'extrato'], ['2022-02', 43.64, 'extrato'], ['2022-03', 43.64, 'extrato']]);
  assert.strictEqual(de('632706066')[0].banco, 'Banco Itaú S.A.');
  assert.strictEqual(de('0099887').filter((d) => d.origem === 'extrato').length, 3);
  assert.strictEqual(de('0099887').filter((d) => d.origem === 'estimado').length, 7, 'o Pan começa em 06/2021, antes do extrato: 06 a 12/2021 estimados');
  assert.deepStrictEqual(de('RMC-55').map((d) => d.valor), [60, 61, 62], 'RMC varia mês a mês: vai para o único cartão RMC ativo');
  assert.deepStrictEqual(r.semDono, []);
});

test('apurarDescontos: meses que o extrato não cobre são estimados pela parcela; meses cobertos sem desconto não', () => {
  // HISCRE cobre só 2022; o contrato do Itaú começa em 2022-01 e segue até hoje (out/2026).
  const cobertos = meses('2022-01', '2022-12');
  const lancamentos = cobertos.filter((c) => c !== '2022-05').map((c) => lanc(c, 43.64, '216 CONSIGNACAO EMPRESTIMO BANCARIO'));
  const r = apurarDescontos({ contratos: [ITAU], lancamentos, competenciasExtrato: cobertos, hoje: HOJE });
  const itau = r.descontos.filter((d) => d.contrato === '632706066');
  assert.ok(!itau.some((d) => d.competencia === '2022-05'), 'maio/2022 está no extrato e não teve desconto: não estima');
  assert.strictEqual(itau.filter((d) => d.origem === 'extrato').length, 11);
  const est = itau.filter((d) => d.origem === 'estimado');
  assert.strictEqual(est[0].competencia, '2023-01');
  assert.strictEqual(est[est.length - 1].competencia, '2026-09', 'até o último mês fechado (o mês corrente ainda não foi pago)');
  assert.ok(r.avisos.some((a) => /632706066/.test(a) && /estimad/i.test(a)));
});

test('apurarDescontos: sem nenhum extrato de pagamento, estima o período inteiro do contrato (até o nº de parcelas)', () => {
  const curto = contrato({ numero: '777', banco: 'Banco Itaú S.A.', parcela: 10, n_parcelas: 3, inicio_desconto: '2025-01' });
  const r = apurarDescontos({ contratos: [curto], lancamentos: [], competenciasExtrato: [], hoje: HOJE });
  assert.deepStrictEqual(r.descontos.map((d) => d.competencia), ['2025-01', '2025-02', '2025-03']);
});

test('apurarDescontos: contrato encerrado não é estimado depois do fim', () => {
  const enc = contrato({ numero: '888', banco: 'Banco Itaú S.A.', parcela: 10, inicio_desconto: '2025-01', fim_desconto: '2025-02', situacao: 'encerrado' });
  const r = apurarDescontos({ contratos: [enc], lancamentos: [], competenciasExtrato: [], hoje: HOJE });
  assert.deepStrictEqual(r.descontos.map((d) => d.competencia), ['2025-01', '2025-02']);
});

test('apurarDescontos: valor que não bate com nenhuma parcela fica sem dono, com o motivo (nunca some calado)', () => {
  const r = apurarDescontos({ contratos: [ITAU, PAN], lancamentos: [lanc('2022-02', 99.99, '216 CONSIGNACAO EMPRESTIMO BANCARIO')], competenciasExtrato: ['2022-02'], hoje: new Date(2022, 2, 5) });
  assert.strictEqual(r.semDono.length, 1);
  assert.match(r.semDono[0].motivo, /parcela/);
  assert.ok(r.avisos.some((a) => /sem contrato/i.test(a)));
});

test('apurarDescontos: duas parcelas iguais de bancos diferentes no mesmo mês vão uma para cada contrato', () => {
  const a = contrato({ numero: 'A1', banco: 'Banco Itaú S.A.', parcela: 50, inicio_desconto: '2023-01' });
  const b = contrato({ numero: 'B1', banco: 'Banco Pan S.A.', parcela: 50, inicio_desconto: '2023-01' });
  const r = apurarDescontos({ contratos: [a, b], lancamentos: [lanc('2023-01', 50, '216'), lanc('2023-01', 50, '216')], competenciasExtrato: ['2023-01'], hoje: new Date(2023, 1, 5) });
  assert.deepStrictEqual(r.descontos.map((d) => d.contrato).sort(), ['A1', 'B1']);
});

test('apurarDescontos: uma parcela igual em dois bancos, mas só um desconto no mês, é ambígua: fica sem dono', () => {
  const a = contrato({ numero: 'A1', banco: 'Banco Itaú S.A.', parcela: 50, inicio_desconto: '2023-01' });
  const b = contrato({ numero: 'B1', banco: 'Banco Pan S.A.', parcela: 50, inicio_desconto: '2023-01' });
  const r = apurarDescontos({ contratos: [a, b], lancamentos: [lanc('2023-01', 50, '216')], competenciasExtrato: ['2023-01'], hoje: new Date(2023, 1, 5) });
  assert.strictEqual(r.descontos.filter((d) => d.origem === 'extrato').length, 0);
  assert.match(r.semDono[0].motivo, /mais de um/);
});

test('apurarDescontos: desconto que o extrato já liga a um contrato fica com ele', () => {
  const r = apurarDescontos({ contratos: [ITAU], lancamentos: [{ ...lanc('2022-02', 43.64, null), contrato: '0632706066' }], competenciasExtrato: ['2022-02'], hoje: new Date(2022, 2, 5) });
  assert.strictEqual(r.descontos[0].contrato, '632706066');
  assert.strictEqual(r.descontos[0].banco, 'Banco Itaú S.A.');
});

test('apurarFicha: a ficha lida sai com os descontos já no contrato certo e os avisos nas lacunas', () => {
  const ficha = parseFichaDeFatos(JSON.stringify({
    contratos: [{ numero: '632706066', tipo: 'emprestimo_consignado', banco: 'Banco Itaú S.A.', parcela: '43,64', n_parcelas: 84, inicio_desconto: '01/2022', fonte: 'HISCON.pdf' }],
    descontos: [{ competencia: '01/2022', valor: '43,64', rubrica: '216 CONSIGNACAO EMPRESTIMO BANCARIO', fonte: 'HISCRE.pdf' }],
    competencias_extrato: ['01/2022'],
  }));
  assert.strictEqual(ficha.descontos[0].rubrica, '216 CONSIGNACAO EMPRESTIMO BANCARIO', 'a rubrica é lida');
  assert.deepStrictEqual(ficha.competencias_extrato, ['2022-01']);
  const f = apurarFicha(ficha, new Date(2022, 2, 5));
  assert.deepStrictEqual(f.descontos.map((d) => [d.competencia, d.contrato, d.banco]), [['2022-01', '632706066', 'Banco Itaú S.A.'], ['2022-02', '632706066', 'Banco Itaú S.A.']]);
  assert.ok(f.lacunas.some((l) => /estimad/i.test(l)));
});

test('calcularPorBanco: uma planilha por banco, cada uma só com os descontos dos contratos daquele banco, tudo em dobro', async () => {
  const { calcularPorBanco } = await import('../dist/services/contabilista.js');
  const ficha = parseFichaDeFatos(JSON.stringify({
    contratos: [
      { numero: '632706066', tipo: 'emprestimo_consignado', banco: 'Banco Itaú S.A.', parcela: 43.64, inicio_desconto: '01/2022' },
      { numero: '0099887', tipo: 'emprestimo_consignado', banco: 'Banco Pan S.A.', parcela: 120.5, inicio_desconto: '01/2022' },
    ],
    descontos: [
      { competencia: '01/2022', valor: 43.64, rubrica: '216 CONSIGNACAO EMPRESTIMO BANCARIO' },
      { competencia: '01/2022', valor: 120.5, rubrica: '216 CONSIGNACAO EMPRESTIMO BANCARIO' },
      { competencia: '02/2022', valor: 43.64, rubrica: '216 CONSIGNACAO EMPRESTIMO BANCARIO' },
      { competencia: '02/2022', valor: 120.5, rubrica: '216 CONSIGNACAO EMPRESTIMO BANCARIO' },
    ],
    competencias_extrato: ['01/2022', '02/2022'],
  }));
  const hoje = new Date(2022, 2, 10);
  const r = calcularPorBanco(apurarFicha(ficha, hoje), null, hoje);
  assert.deepStrictEqual(r.map((b) => b.banco), ['Banco Itaú S.A.', 'Banco Pan S.A.']);
  const itau = r[0].calculo;
  assert.strictEqual(itau.indebito.total.descontado, 87.28);
  assert.strictEqual(itau.indebito.total.restituir, 174.56, 'Tema 929: tudo em dobro');
  assert.strictEqual(r[1].calculo.indebito.total.restituir, 482);
  assert.ok(r[0].calculo.atualizacao, 'sai a planilha (nominal, sem índices)');
});

test('calcularPorBanco: mesmo banco, modalidades diferentes = cálculos separados (empréstimo consignado ≠ cartão RMC/RCC); RMC e RCC do mesmo banco juntos', async () => {
  const { calcularPorBanco } = await import('../dist/services/contabilista.js');
  const ficha = parseFichaDeFatos(JSON.stringify({
    contratos: [
      { numero: 'E1', tipo: 'emprestimo_consignado', banco: 'Banco Itaú S.A.', parcela: 43.64, inicio_desconto: '01/2022' },
      { numero: 'R1', tipo: 'rmc', banco: 'Itaú Consignado S.A.', inicio_desconto: '01/2022' },
      { numero: 'C1', tipo: 'rcc', banco: 'Banco Itaú S.A.', inicio_desconto: '01/2022' },
    ],
    descontos: [
      { competencia: '01/2022', valor: 43.64, rubrica: '216 CONSIGNACAO EMPRESTIMO BANCARIO' },
      { competencia: '01/2022', valor: 70, rubrica: '217 EMPRESTIMO SOBRE A RMC' },
      { competencia: '01/2022', valor: 30, rubrica: '268 CONSIGNACAO - CARTAO' },
    ],
    competencias_extrato: ['01/2022'],
  }));
  const hoje = new Date(2022, 1, 10);
  const r = calcularPorBanco(apurarFicha(ficha, hoje), null, hoje);
  // O nome do banco vem do 1º contrato do grupo ("Itaú Consignado S.A." é o mesmo Itaú).
  assert.deepStrictEqual(r.map((b) => b.modalidade).sort(), ['Cartão consignado (RMC/RCC)', 'Empréstimo consignado']);
  const cartao = r.find((b) => b.familia === 'cartao_consignado'), emp = r.find((b) => b.familia === 'emprestimo_consignado');
  assert.strictEqual(cartao.calculo.indebito.total.descontado, 100, 'RMC 70 + RCC 30, cada um na sua linha');
  assert.deepStrictEqual(cartao.calculo.indebito.porContrato.map((c) => c.contrato).sort(), ['C1', 'R1']);
  assert.strictEqual(emp.calculo.indebito.total.descontado, 43.64);
  assert.deepStrictEqual(emp.calculo.indebito.porContrato.map((c) => c.contrato), ['E1']);
});
