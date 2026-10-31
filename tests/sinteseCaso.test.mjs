// tests/sinteseCaso.test.mjs — "Sobre o caso" do card do cliente (31/10/2026, print da Jessica:
// o bloco mostrava a descrição da ação do Itaú como se fosse o caso inteiro, que tem 6 bancos).
// A síntese junta o cliente inteiro a partir do que foi LIDO nos documentos (contratos do
// extrato de empréstimos, descontos, triagem, fatos), sem IA e sem inventar. Dados fictícios.
import { test } from 'node:test';
import assert from 'node:assert';
import { sintetizarCaso } from '../dist/services/sinteseCaso.js';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const acao = (id, reu, familia, situacao = 'em_preparo') => ({ id, reu, familia, situacao, titulo: `Fulano · ${reu}` });
const contrato = (id, dados, extra = {}) => ({ id, chave: `k${id}`, case_id: null, fora: false, dados: { numero: null, tipo: null, banco: null, data: null, valor_liberado: null, parcela: null, n_parcelas: null, parcelas_pagas: null, taxa_mensal: null, taxa_media_mercado: null, inicio_desconto: null, fim_desconto: null, situacao: null, ...dados }, ...extra });
const fichaVazia = () => ({ reus: [], contratos: [], descontos: [], competencias_extrato: [], fatos: [], valores: [], vinculo: null, triagem: {}, pedidos_do_cliente: [], lacunas: [] });

const acoes = [
  acao(110, 'Banco Itaú S.A.', 'emprestimo_consignado', 'revisar'),
  acao(111, 'Banco Pine S.A.', 'emprestimo_consignado'),
  acao(114, 'Banco PAN S.A.', 'cartao_consignado'),
];
const contratos = [
  contrato(1, { numero: '111222333', tipo: 'emprestimo_consignado', banco: 'ITAU CONSIGNADO S.A.', data: '10/03/2021', parcela: 150.5, n_parcelas: 84, inicio_desconto: '04/2021', situacao: 'ativo' }),
  contrato(2, { numero: '444555', tipo: 'emprestimo_consignado', banco: 'BANCO PINE S.A.', parcela: 90, n_parcelas: 72, inicio_desconto: '01/2022', situacao: 'ativo' }),
  contrato(3, { numero: '766659645-2', tipo: 'rcc', banco: 'BANCO PAN S.A.', inicio_desconto: '05/2020', situacao: 'ativo' }),
  contrato(4, { numero: '999', tipo: 'emprestimo_consignado', banco: 'BANCO BMG S.A.', situacao: 'ativo' }),
  contrato(5, { numero: '888', tipo: 'emprestimo_consignado', banco: 'BANCO ITAU S.A.', situacao: 'excluido' }, { fora: true }),
];

test('SQL da síntese do caso não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos(['src/services/sinteseCasoMysql.ts']);
  assert.deepStrictEqual(tabelasInexistentes, []);
  assert.deepStrictEqual(colunasInexistentes, []);
});

test('síntese fala do cliente inteiro: todos os contratos e instituições, não só a 1ª ação', () => {
  const s = sintetizarCaso({ cliente: 'Fulano de Tal', acoes, contratos, ficha: null, relatoCliente: null, origem: { parceiro: 'Parceira X', chegouEm: '2026-10-20' } });
  assert.match(s.paragrafo, /^Fulano de Tal/);
  assert.match(s.paragrafo, /4 contratos/);
  assert.match(s.paragrafo, /4 instituições/);
  assert.match(s.paragrafo, /benefício do INSS/);
  assert.match(s.paragrafo, /Parceira X/);
  assert.match(s.paragrafo, /20\/10\/2026/);
  assert.doesNotMatch(s.paragrafo, /Itaú S\.A\.\s*·/);
});

test('por instituição: contratos do extrato ligados à ação do mesmo banco; banco sem ação fica em destaque', () => {
  const s = sintetizarCaso({ cliente: 'Fulano', acoes, contratos, ficha: null, relatoCliente: null, origem: null });
  const itau = s.instituicoes.find((i) => i.acoes.includes(110));
  assert.ok(itau, 'Itaú');
  assert.deepStrictEqual(itau.contratos.map((c) => c.numero), ['111222333'], 'o contrato que a Dra. tirou das peças não entra');
  assert.strictEqual(itau.contratos[0].tipo, 'Empréstimo consignado');
  assert.strictEqual(itau.contratos[0].parcela, 150.5);
  const bmg = s.instituicoes.find((i) => /BMG/.test(i.banco));
  assert.deepStrictEqual(bmg.acoes, []);
  assert.strictEqual(s.foraDasPecas, 1);
  assert.ok(s.alertas.some((a) => /BMG/.test(a) && /sem ação/.test(a)), JSON.stringify(s.alertas));
});

test('ação sem contrato lido aparece também (o extrato pode não ter sido lido ainda)', () => {
  const s = sintetizarCaso({ cliente: 'Fulano', acoes: [...acoes, acao(115, 'Facta Financeira S.A.', 'cartao_consignado')], contratos, ficha: null, relatoCliente: null, origem: null });
  const facta = s.instituicoes.find((i) => i.acoes.includes(115));
  assert.ok(facta && facta.contratos.length === 0);
  assert.ok(s.alertas.some((a) => /Facta/.test(a) && /nenhum contrato/.test(a)));
});

test('descontos lidos no histórico de créditos são somados por instituição (pelo contrato), com período', () => {
  const ficha = { ...fichaVazia(), contratos: contratos.map((c) => c.dados),
    descontos: [
      { competencia: '04/2021', valor: 150.5, contrato: '111222333', banco: null, rubrica: '216 CONSIGNACAO EMPRESTIMO BANCARIO', fonte: 'hiscre' },
      { competencia: '05/2021', valor: 150.5, contrato: '111222333', banco: null, rubrica: '216 CONSIGNACAO EMPRESTIMO BANCARIO', fonte: 'hiscre' },
    ],
    competencias_extrato: ['04/2021', '05/2021'] };
  const s = sintetizarCaso({ cliente: 'Fulano', acoes, contratos, ficha, relatoCliente: null, origem: null, hoje: new Date('2021-06-15T12:00:00Z') });
  const itau = s.instituicoes.find((i) => i.acoes.includes(110));
  assert.ok(itau.descontos, JSON.stringify(itau));
  assert.strictEqual(itau.descontos.meses, 2);
  assert.strictEqual(itau.descontos.total, 301);
  assert.strictEqual(itau.descontos.de, '04/2021');
  assert.strictEqual(itau.descontos.ate, '05/2021');
});

test('triagem vira pontos de fato em português; fatos em ordem de data; pedidos e lacunas', () => {
  const ficha = { ...fichaVazia(),
    triagem: { nunca_contratou: true, recebeu_cartao: false, idoso: true, houve_saque: null },
    fatos: [{ data: '15/08/2023', texto: 'Percebeu os descontos', fonte: 'x' }, { data: '10/03/2021', texto: 'Inclusão do contrato do Itaú', fonte: 'y' }, { data: null, texto: 'Procurou o banco sem sucesso', fonte: 'z' }],
    pedidos_do_cliente: ['Parar os descontos', 'Receber o que foi descontado'],
    lacunas: ['Número do benefício', 'Número do benefício'] };
  const s = sintetizarCaso({ cliente: 'Fulano', acoes, contratos, ficha, relatoCliente: '  Fulano diz que nunca pediu empréstimo.  ', origem: null });
  assert.deepStrictEqual(s.pontos, ['Diz que nunca contratou', 'Diz que não recebeu o cartão', 'É idoso(a)']);
  assert.deepStrictEqual(s.fatos.map((f) => f.texto), ['Inclusão do contrato do Itaú', 'Percebeu os descontos', 'Procurou o banco sem sucesso']);
  assert.deepStrictEqual(s.pedidos, ['Parar os descontos', 'Receber o que foi descontado']);
  assert.deepStrictEqual(s.lacunas, ['Número do benefício']);
  assert.strictEqual(s.relatoCliente, 'Fulano diz que nunca pediu empréstimo.');
  assert.strictEqual(s.base, 'lida');
});

test('sem contratos lidos, a síntese diz que a base ainda não foi lida (não inventa números)', () => {
  const s = sintetizarCaso({ cliente: 'Fulano', acoes, contratos: [], ficha: null, relatoCliente: null, origem: null });
  assert.strictEqual(s.base, 'nao_lida');
  assert.match(s.paragrafo, /3 ações/);
  assert.match(s.paragrafo, /ainda não foram lidos/);
  assert.doesNotMatch(s.paragrafo, /contratos com/);
});
