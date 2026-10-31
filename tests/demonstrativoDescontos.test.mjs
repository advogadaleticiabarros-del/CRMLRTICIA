// tests/demonstrativoDescontos.test.mjs — Demonstrativo de descontos (pedido da
// Jessica, 30/10/2026): documento à parte, por peça, com o que foi descontado de
// cada contrato (RMC/RCC…) até agora e a base do valor da causa. O extrato
// original do INSS continua indo inteiro no protocolo.
import { test } from 'node:test';
import assert from 'node:assert';
import { calcularPeca } from '../dist/services/pecaCalculos.js';
import { atualizarCalculo } from '../dist/services/planilhaCalculos.js';
import { montarDemonstrativo, demonstrativoMarkdown, demonstrativoPdf } from '../dist/services/demonstrativoDescontos.js';
import { classificarDocumento } from '../dist/services/loteProducao.js';

const contrato = (o) => ({
  numero: null, tipo: null, banco: null, data: null, valor_liberado: null, parcela: null, n_parcelas: null, parcelas_pagas: null,
  taxa_mensal: null, taxa_media_mercado: null, inicio_desconto: null, fim_desconto: null, situacao: null, fonte: null, ...o,
});
const HOJE = new Date(2026, 9, 30);

function cenario({ danoMoral = 10000 } = {}) {
  const contratos = [
    contrato({ numero: '0012-345', tipo: 'rmc', banco: 'Banco Fictício S.A.', data: '10/02/2021', situacao: 'Ativo', fonte: 'Extrato de empréstimos' }),
    contrato({ numero: '998877', tipo: 'rcc', banco: 'Banco Fictício S.A.', data: '05/06/2022', situacao: 'Ativo', fonte: 'Extrato de empréstimos' }),
  ];
  const descontos = [
    { competencia: '2021-03', valor: 50, contrato: '12345', fonte: 'Histórico de créditos, pág. 2' },
    { competencia: '2021-04', valor: 50, contrato: '0012-345', fonte: 'Histórico de créditos, pág. 2' },
    { competencia: '2022-07', valor: 30.5, contrato: '998877', fonte: 'Histórico de créditos, pág. 4' },
    { competencia: '2022-08', valor: 30.5, contrato: '998877', fonte: 'Histórico de créditos, pág. 4' },
  ];
  const calculo = calcularPeca({ contratos, descontos, hoje: HOJE, danoMoral });
  return { contratos, calculo };
}

test('agrupa os descontos por contrato (nº com ou sem pontuação), com tipo, banco, período e total descontado', () => {
  const { contratos, calculo } = cenario();
  const d = montarDemonstrativo({ calculo, contratos, cab: { cliente: 'Fulana de Teste', reus: ['Banco Fictício S.A.'], geradaEm: HOJE } });
  assert.strictEqual(d.contratos.length, 2);
  const [rmc, rcc] = d.contratos;
  assert.strictEqual(rmc.numero, '0012-345');
  assert.strictEqual(rmc.nomeTipo, 'Cartão RMC');
  assert.strictEqual(rmc.banco, 'Banco Fictício S.A.');
  assert.strictEqual(rmc.meses, 2);
  assert.strictEqual(rmc.descontado, 100);
  assert.strictEqual(rmc.periodo, '03/2021 a 04/2021');
  assert.deepStrictEqual(rmc.linhas.map((l) => l.fonte), ['Histórico de créditos, pág. 2', 'Histórico de créditos, pág. 2']);
  assert.strictEqual(rcc.nomeTipo, 'Cartão RCC');
  assert.strictEqual(rcc.descontado, 61);
  assert.strictEqual(d.totalDescontado, 161);
  assert.strictEqual(d.totalMeses, 4);
});

test('valor da causa: sem planilha atualizada usa a restituição nominal (tudo em dobro, Tema 929) + dano moral', () => {
  const { contratos, calculo } = cenario();
  const d = montarDemonstrativo({ calculo, contratos, cab: { cliente: 'Fulana', geradaEm: HOJE } });
  // 50×2 + 50×2 + 30,50×2×2 = 322
  assert.strictEqual(d.valorDaCausa.restituirNominal, 322);
  assert.strictEqual(d.valorDaCausa.restituicao, 322);
  assert.strictEqual(d.valorDaCausa.atualizadoAte, null);
  assert.strictEqual(d.valorDaCausa.danoMoral, 10000);
  assert.strictEqual(d.valorDaCausa.total, 10322);
});

test('valor da causa: com a planilha do Calculista, usa a restituição atualizada e a data-base', () => {
  const { contratos, calculo } = cenario();
  const meses = {};
  for (let a = 2021; a <= 2026; a++) for (let m = 1; m <= 12; m++) meses[`${a}-${String(m).padStart(2, '0')}`] = 0;
  const atual = atualizarCalculo(calculo, { inpc: meses, ipca: { ...meses, '2026-09': 0 }, selic: { ...meses, '2026-09': 1 } }, HOJE);
  const d = montarDemonstrativo({ calculo: atual, contratos, cab: { cliente: 'Fulana', geradaEm: HOJE } });
  assert.strictEqual(d.valorDaCausa.atualizadoAte, '2026-09');
  assert.strictEqual(d.valorDaCausa.restituicao, atual.atualizacao.total.total);
  assert.ok(d.valorDaCausa.restituicao > 272, 'juros de mora somam à restituição');
  assert.strictEqual(d.valorDaCausa.total, atual.valorDaCausa.total);
});

test('desconto sem contrato conhecido aparece num grupo próprio; contrato sem desconto lido fica listado com aviso', () => {
  const contratos = [contrato({ numero: '555', tipo: 'rmc', banco: 'Banco X' }), contrato({ numero: '777', tipo: 'rcc', banco: 'Banco X' })];
  const calculo = calcularPeca({ contratos, descontos: [{ competencia: '2023-01', valor: 20, contrato: null }, { competencia: '2023-02', valor: 20, contrato: '555' }], hoje: HOJE });
  const d = montarDemonstrativo({ calculo, contratos, cab: { cliente: 'Fulana' } });
  const nomes = d.contratos.map((c) => c.numero);
  assert.deepStrictEqual(nomes, ['555', '777', null]);
  assert.strictEqual(d.contratos[1].meses, 0);
  assert.ok(d.avisos.some((a) => /777/.test(a) && /nenhum desconto/i.test(a)));
  assert.ok(d.avisos.some((a) => /sem o número do contrato/i.test(a)));
});

test('contratos de outros bancos ficam listados como "fora desta peça", sem entrar no total', () => {
  const { contratos, calculo } = cenario();
  const fora = [{ contrato: contrato({ numero: '4444', tipo: 'rmc', banco: 'Outro Banco' }), motivo: 'outro banco (Outro Banco): não é o réu deste processo' }];
  const d = montarDemonstrativo({ calculo, contratos, fora, cab: { cliente: 'Fulana' } });
  assert.strictEqual(d.fora.length, 1);
  assert.strictEqual(d.fora[0].numero, '4444');
  assert.strictEqual(d.totalDescontado, 161);
  const md = demonstrativoMarkdown(d);
  assert.match(md, /Ficaram fora desta peça/);
  assert.match(md, /4444/);
});

test('markdown: título, resumo por contrato, mês a mês com a fonte, valor da causa e a nota do extrato original', () => {
  const { contratos, calculo } = cenario();
  const md = demonstrativoMarkdown(montarDemonstrativo({ calculo, contratos, cab: { cliente: 'Fulana de Teste', reus: ['Banco Fictício S.A.'], geradaEm: HOJE } }));
  assert.match(md, /^# Demonstrativo de descontos — Fulana de Teste/);
  assert.match(md, /\| 0012-345 \| Cartão RMC \| Banco Fictício S\.A\. \|/);
  assert.match(md, /\| 03\/2021 \| 0012-345 \| R\$\s?50,00 \| Histórico de créditos, pág\. 2 \|/);
  assert.match(md, /Total descontado até agora/);
  assert.match(md, /Valor da causa/);
  assert.match(md, /extrato original do INSS/i);
});

test('sem nenhum desconto lido: demonstrativo diz que não há o que demonstrar', () => {
  const calculo = calcularPeca({ contratos: [], descontos: [], hoje: HOJE });
  const d = montarDemonstrativo({ calculo, contratos: [], cab: { cliente: 'Fulana' } });
  assert.strictEqual(d.contratos.length, 0);
  assert.match(demonstrativoMarkdown(d), /Nenhum desconto lido/);
});

test('PDF: gera um arquivo PDF válido, inclusive com muitas linhas (várias páginas)', async () => {
  const contratos = [contrato({ numero: '1', tipo: 'rmc', banco: 'Banco X' })];
  const descontos = [];
  for (let a = 2016; a <= 2026; a++) for (let m = 1; m <= 12; m++) descontos.push({ competencia: `${a}-${String(m).padStart(2, '0')}`, valor: 45.9, contrato: '1', fonte: 'Histórico de créditos' });
  const calculo = calcularPeca({ contratos, descontos, hoje: HOJE });
  const pdf = await demonstrativoPdf(montarDemonstrativo({ calculo, contratos, cab: { cliente: 'Fulana', reus: ['Banco X'], geradaEm: HOJE } }));
  assert.ok(Buffer.isBuffer(pdf));
  assert.strictEqual(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length >= 3, 'mais de uma página');
});

test('kit: o demonstrativo é anexo da ação (antes da planilha), não documento interno', () => {
  const c = classificarDocumento({ name: 'Demonstrativo de descontos — Fulana (v2)', content: 'x', type: 'ia' });
  assert.strictEqual(c.tipo, 'demonstrativo');
  assert.strictEqual(c.escopo, 'acao');
  const p = classificarDocumento({ name: 'Planilha de cálculos — Fulana (v2)', content: 'x', type: 'ia' });
  assert.ok(c.ordem < p.ordem);
});
