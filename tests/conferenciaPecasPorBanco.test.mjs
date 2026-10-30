// tests/conferenciaPecasPorBanco.test.mjs — regra da Jessica (30/10/2026): RMC e RCC
// de bancos diferentes são peças diferentes (RMC de um banco, RCC de outro → duas
// peças); do mesmo banco podem ir juntas. A leitura dos extratos confere isso contra
// as ações do cliente.
import { test } from 'node:test';
import assert from 'node:assert';
import { conferirPecasPorBanco } from '../dist/services/contratosDoCaso.js';
import { montarLote } from '../dist/services/loteProducao.js';

const ct = (o, extra = {}) => ({
  id: 1, chave: `n:${o.numero}`, case_id: null, fora: false, ...extra,
  dados: { numero: null, tipo: null, banco: null, data: null, valor_liberado: null, parcela: null, n_parcelas: null, parcelas_pagas: null,
    taxa_mensal: null, taxa_media_mercado: null, inicio_desconto: null, fim_desconto: null, situacao: null, fonte: null, ...o },
});
const acao = (id, titulo, ...bancos) => ({ id, titulo, reus: bancos.map((nome) => ({ nome, cpf_cnpj: null })) });
const tipos = (c) => c.problemas.map((p) => p.tipo).sort();

test('RMC de um banco e RCC de outro, cada um com a sua ação: duas peças, sem problema', () => {
  const c = conferirPecasPorBanco(
    [ct({ numero: '111', tipo: 'rmc', banco: 'Banco Pan S.A.' }), ct({ numero: '222', tipo: 'rcc', banco: 'Banco BMG S.A.' })],
    [acao(10, 'Cartão RMC - Banco Pan', 'Banco Pan S.A.'), acao(11, 'Cartão RCC - BMG', 'Banco BMG S.A.')],
  );
  assert.strictEqual(c.bancos.length, 2);
  assert.deepStrictEqual(c.bancos.map((b) => b.acoes), [[10], [11]]);
  assert.deepStrictEqual(c.problemas, []);
});

test('RMC e RCC do mesmo banco: uma peça só, as duas na mesma ação', () => {
  const c = conferirPecasPorBanco(
    [ct({ numero: '111', tipo: 'rmc', banco: 'Banco Pan S.A.' }), ct({ numero: '222', tipo: 'rcc', banco: 'BANCO PAN' })],
    [acao(10, 'RMC e RCC - Banco Pan', 'Banco Pan S.A.')],
  );
  assert.strictEqual(c.bancos.length, 1);
  assert.deepStrictEqual(c.bancos[0].tipos, ['Cartão RMC', 'Cartão RCC']);
  assert.deepStrictEqual(c.problemas, []);
});

test('RCC de outro banco sem ação própria: avisa que precisa de outra peça', () => {
  const c = conferirPecasPorBanco(
    [ct({ numero: '111', tipo: 'rmc', banco: 'Banco Pan S.A.' }), ct({ numero: '222', tipo: 'rcc', banco: 'Banco BMG S.A.' })],
    [acao(10, 'RMC e RCC - Banco Pan', 'Banco Pan S.A.')],
  );
  assert.deepStrictEqual(tipos(c), ['falta_acao']);
  assert.match(c.problemas[0].texto, /BMG/);
  assert.match(c.problemas[0].texto, /222/);
  assert.match(c.problemas[0].texto, /peça própria/);
});

test('uma ação contra dois bancos: são peças diferentes, separar', () => {
  const c = conferirPecasPorBanco(
    [ct({ numero: '111', tipo: 'rmc', banco: 'Banco Pan S.A.' }), ct({ numero: '222', tipo: 'rcc', banco: 'Banco BMG S.A.' })],
    [acao(10, 'Cartão RMC e RCC', 'Banco Pan S.A.', 'Banco BMG S.A.')],
  );
  assert.deepStrictEqual(tipos(c), ['bancos_misturados']);
  assert.strictEqual(c.problemas[0].acaoId, 10);
});

test('contrato que a Dra. pôs numa ação de outro banco: avisa', () => {
  const c = conferirPecasPorBanco(
    [ct({ numero: '111', tipo: 'rmc', banco: 'Banco Pan S.A.' }), ct({ numero: '222', tipo: 'rcc', banco: 'Banco BMG S.A.' }, { case_id: 10 })],
    [acao(10, 'Cartão RMC - Pan', 'Banco Pan S.A.')],
  );
  assert.ok(c.problemas.some((p) => p.tipo === 'bancos_misturados' && /222/.test(p.texto)));
});

test('ação de cartão cujo banco não aparece no extrato; contrato sem banco; contrato tirado pela Dra. não conta', () => {
  const c = conferirPecasPorBanco(
    [ct({ numero: '111', tipo: 'rmc', banco: null }), ct({ numero: '333', tipo: 'rcc', banco: 'Banco C6' }, { fora: true })],
    [acao(10, 'Cartão RMC - Banco Daycoval', 'Banco Daycoval S.A.')],
  );
  assert.deepStrictEqual(tipos(c), ['acao_sem_contrato', 'banco_nao_identificado']);
});

test('duas ações de cartão contra o mesmo banco: sugere juntar numa peça só', () => {
  const c = conferirPecasPorBanco(
    [ct({ numero: '111', tipo: 'rmc', banco: 'Banco Pan S.A.' }), ct({ numero: '222', tipo: 'rcc', banco: 'Banco Pan S.A.' })],
    [acao(10, 'Cartão RMC - Pan', 'Banco Pan S.A.'), acao(11, 'Cartão RCC - Pan', 'Banco Pan S.A.')],
  );
  assert.deepStrictEqual(tipos(c), ['mesmo_banco_separado']);
  assert.match(c.problemas[0].texto, /podem ir numa peça só/);
});

test('empréstimo consignado não entra na conferência de cartões; sem extrato lido, avisa que ainda não dá para conferir', () => {
  const c = conferirPecasPorBanco([ct({ numero: '9', tipo: 'emprestimo_consignado', banco: 'Banco Itaú' })], [acao(10, 'Cartão RMC - Pan', 'Banco Pan S.A.')]);
  assert.strictEqual(c.lidos, false);
  assert.deepStrictEqual(tipos(c), ['nao_lidos']);
  const vazio = conferirPecasPorBanco([], [acao(10, 'Empréstimo consignado - Itaú', 'Banco Itaú')]);
  assert.deepStrictEqual(vazio.problemas, [], 'sem ação de cartão, nada a conferir');
});

test('ação sem tese no título vale pelo banco do réu', () => {
  const c = conferirPecasPorBanco([ct({ numero: '111', tipo: 'rmc', banco: 'Banco Pan S.A.' })], [acao(10, 'Ação contra o Pan', 'Banco Pan S.A.')]);
  assert.deepStrictEqual(c.problemas, []);
  assert.deepStrictEqual(c.bancos[0].acoes, [10]);
});

test('card único do cliente traz a conferência dos extratos', () => {
  const lote = montarLote({
    cliente: 'Fulana',
    acoes: [{ id: 10, titulo: 'RMC - Banco Pan', production_stage: 'criacao_inicial', case_number: null, legal_area: 'consumidor', partes: [{ nome: 'Banco Pan S.A.', cpf_cnpj: null }] }],
    documentos: [],
    contratos: [ct({ numero: '111', tipo: 'rmc', banco: 'Banco Pan S.A.' }), ct({ numero: '222', tipo: 'rcc', banco: 'Banco BMG S.A.' })],
  });
  assert.deepStrictEqual(tipos(lote.conferencia), ['falta_acao']);
});
