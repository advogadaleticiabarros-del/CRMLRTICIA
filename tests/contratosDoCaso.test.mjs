// tests/contratosDoCaso.test.mjs — quais contratos lidos nos documentos entram
// numa peça: só os do réu e da tese do processo, ou os que a Dra. escolheu.
// Caso real (28/10/2026): peça contra o Itaú (empréstimo consignado) saiu com um
// empréstimo do BANCO PAN e um cartão RMC da FACTA, lidos no extrato do INSS.
import { test } from 'node:test';
import assert from 'node:assert';
import { chaveContrato, mesmoBanco, familiaDoContrato, separarParaPeca, inventarioDaPeca } from '../dist/services/contratosDoCaso.js';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const ct = (numero, tipo, banco, extra = {}) => ({
  numero, tipo, banco, data: null, valor_liberado: null, parcela: null, n_parcelas: null, parcelas_pagas: null,
  taxa_mensal: null, taxa_media_mercado: null, inicio_desconto: null, fim_desconto: null, situacao: 'ativo', fonte: 'hiscon.pdf', ...extra,
});
const pecaItau = { casos: [{ id: 10, titulo: 'empréstimo consignado — Banco Itaú S.A.' }], reus: [{ nome: 'Banco Itaú S.A.' }] };

test('SQL dos contratos do cliente não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos(['src/services/esteiraPecaMysql.ts', 'src/routes/mesa.ts']);
  assert.deepStrictEqual(tabelasInexistentes, []);
  assert.deepStrictEqual(colunasInexistentes, []);
});

test('chaveContrato: o mesmo contrato escrito de jeitos diferentes tem a mesma chave', () => {
  assert.strictEqual(chaveContrato(ct('766659645-2', 'emprestimo_consignado', 'BANCO PAN S.A.')), chaveContrato(ct('7666596452', 'emprestimo_consignado', 'Banco Pan')));
  assert.strictEqual(chaveContrato(ct('0059967160', 'rmc', 'FACTA')), chaveContrato(ct('59967160', 'rmc', 'Facta Financeira')));
  // Sem número: banco + tipo + data.
  assert.strictEqual(chaveContrato(ct(null, 'rmc', 'Banco BMG S.A.', { data: '02/05/2023' })), chaveContrato(ct(null, 'RMC', 'BMG', { data: '02/05/2023' })));
  assert.notStrictEqual(chaveContrato(ct(null, 'rmc', 'BMG', { data: '02/05/2023' })), chaveContrato(ct(null, 'rcc', 'BMG', { data: '02/05/2023' })));
});

test('mesmoBanco: tolera "Banco", S.A. e o nome do grupo; bancos diferentes não batem', () => {
  assert.ok(mesmoBanco('ITAU CONSIGNADO S.A.', 'Banco Itaú S.A.'));
  assert.ok(mesmoBanco('Banco Itaú Unibanco S.A.', 'Itaú'));
  assert.ok(mesmoBanco('BANCO C6 CONSIGNADO S.A.', 'Banco C6 S.A.'));
  assert.ok(mesmoBanco('FACTA FINANCEIRA S.A. CREDITO FINANCIAMENTO E INVESTIMENTO', 'Facta Financeira'));
  assert.ok(!mesmoBanco('BANCO PAN S.A.', 'Banco Itaú S.A.'));
  assert.ok(!mesmoBanco('FACTA FINANCEIRA S.A.', 'Banco Itaú S.A.'));
  assert.ok(!mesmoBanco('Banco do Brasil', 'Banco de Brasília (BRB)'));
  assert.ok(!mesmoBanco(null, 'Banco Itaú'));
});

test('familiaDoContrato: RMC e RCC são cartão consignado; refinanciamento e portabilidade são empréstimo consignado', () => {
  assert.strictEqual(familiaDoContrato('rmc'), 'cartao_consignado');
  assert.strictEqual(familiaDoContrato('RCC'), 'cartao_consignado');
  assert.strictEqual(familiaDoContrato('emprestimo_consignado'), 'emprestimo_consignado');
  assert.strictEqual(familiaDoContrato('refinanciamento'), 'emprestimo_consignado');
  assert.strictEqual(familiaDoContrato('portabilidade'), 'emprestimo_consignado');
  assert.strictEqual(familiaDoContrato('emprestimo_pessoal'), 'emprestimo_pessoal');
  assert.strictEqual(familiaDoContrato('cartao_comum'), 'cartao_comum');
  assert.strictEqual(familiaDoContrato('outro'), null);
});

test('separarParaPeca: caso Valmirio — PAN e FACTA ficam fora da peça contra o Itaú, com o motivo', () => {
  const r = separarParaPeca({
    contratos: [
      ct('766659645-2', 'emprestimo_consignado', 'BANCO PAN S.A.'),
      ct('0059967160', 'rmc', 'FACTA FINANCEIRA S.A.'),
      ct('123456', 'emprestimo_consignado', 'ITAU CONSIGNADO S.A.'),
    ],
    descontos: [], salvos: [], peca: pecaItau,
  });
  assert.deepStrictEqual(r.entram.map((c) => c.numero), ['123456']);
  const fora = Object.fromEntries(r.fora.map((f) => [f.contrato.numero, f.motivo]));
  assert.match(fora['766659645-2'], /outro banco/i);
  assert.match(fora['0059967160'], /outro banco/i);
});

test('separarParaPeca: mesmo banco mas outra tese (RMC numa peça de empréstimo) fica fora', () => {
  const r = separarParaPeca({ contratos: [ct('1', 'rmc', 'Banco Itaú'), ct('2', 'emprestimo_consignado', 'Banco Itaú')], descontos: [], salvos: [], peca: pecaItau });
  assert.deepStrictEqual(r.entram.map((c) => c.numero), ['2']);
  assert.match(r.fora[0].motivo, /outra tese/i);
});

test('separarParaPeca: RMC e RCC do mesmo banco entram juntos na peça de cartão consignado', () => {
  const peca = { casos: [{ id: 1, titulo: 'RMC — Banco BMG' }, { id: 2, titulo: 'RCC — Banco BMG' }], reus: [{ nome: 'Banco BMG S.A.' }] };
  const r = separarParaPeca({ contratos: [ct('A', 'rmc', 'BANCO BMG SA'), ct('B', 'rcc', 'BMG'), ct('C', 'rmc', 'Banco Pan')], descontos: [], salvos: [], peca });
  assert.deepStrictEqual(r.entram.map((c) => c.numero), ['A', 'B']);
});

test('separarParaPeca: sem nenhum contrato do réu nos documentos, avisa em vez de usar os de outros bancos', () => {
  const r = separarParaPeca({ contratos: [ct('766659645-2', 'emprestimo_consignado', 'BANCO PAN S.A.')], descontos: [], salvos: [], peca: pecaItau });
  assert.deepStrictEqual(r.entram, []);
  assert.ok(r.avisos.some((a) => /nenhum contrato/i.test(a) && /Itaú/.test(a)), r.avisos.join(' | '));
});

test('separarParaPeca: contrato sem banco no documento fica fora até a Dra. decidir', () => {
  const r = separarParaPeca({ contratos: [ct('9', 'emprestimo_consignado', null)], descontos: [], salvos: [], peca: pecaItau });
  assert.deepStrictEqual(r.entram, []);
  assert.match(r.fora[0].motivo, /banco não aparece/i);
});

test('separarParaPeca: a escolha da Dra. vale acima da regra automática', () => {
  const pan = ct('766659645-2', 'emprestimo_consignado', 'BANCO PAN S.A.');
  const itau = ct('123456', 'emprestimo_consignado', 'Banco Itaú');
  const r = separarParaPeca({
    contratos: [pan, itau], descontos: [], peca: pecaItau,
    salvos: [
      { id: 1, chave: chaveContrato(pan), case_id: 10, fora: false, dados: pan },
      { id: 2, chave: chaveContrato(itau), case_id: null, fora: true, dados: itau },
    ],
  });
  assert.deepStrictEqual(r.entram.map((c) => c.numero), ['766659645-2']);
  assert.match(r.fora[0].motivo, /Dra\./);
  assert.ok(r.avisos.some((a) => /766659645-2/.test(a) && /réu/i.test(a)), 'avisa que o banco escolhido não é o réu cadastrado');
});

test('separarParaPeca: contrato que a Dra. pôs em outro caso fica fora desta peça', () => {
  const pan = ct('766659645-2', 'emprestimo_consignado', 'Banco Itaú');
  const r = separarParaPeca({ contratos: [pan], descontos: [], peca: pecaItau, salvos: [{ id: 1, chave: chaveContrato(pan), case_id: 99, fora: false, dados: pan }] });
  assert.deepStrictEqual(r.entram, []);
  assert.match(r.fora[0].motivo, /#99/);
});

test('separarParaPeca: contrato escolhido pela Dra. entra mesmo se a leitura de agora não o achou', () => {
  const guardado = ct('555', 'emprestimo_consignado', 'Banco Itaú', { parcela: 120 });
  const r = separarParaPeca({ contratos: [], descontos: [], peca: pecaItau, salvos: [{ id: 1, chave: chaveContrato(guardado), case_id: 10, fora: false, dados: guardado }] });
  assert.deepStrictEqual(r.entram.map((c) => c.numero), ['555']);
});

test('separarParaPeca: descontos de contratos que ficaram fora saem do cálculo', () => {
  const r = separarParaPeca({
    contratos: [ct('PAN1', 'emprestimo_consignado', 'Banco Pan'), ct('ITA1', 'emprestimo_consignado', 'Banco Itaú')],
    descontos: [
      { competencia: '2023-01', valor: 89.2, contrato: 'PAN1' },
      { competencia: '2023-01', valor: 50, contrato: 'ITA1' },
      { competencia: '2023-02', valor: 70, contrato: null, banco: 'BANCO PAN S.A.' },
      { competencia: '2023-02', valor: 50, contrato: null, banco: 'Itaú Consignado' },
      { competencia: '2023-03', valor: 33, contrato: null },
    ],
    salvos: [], peca: pecaItau,
  });
  assert.deepStrictEqual(r.descontos.map((d) => d.valor), [50, 50]);
  assert.ok(r.avisos.some((a) => /1 desconto/i.test(a) && /sem contrato/i.test(a)), r.avisos.join(' | '));
});

test('separarParaPeca: quando nada fica fora, os descontos sem contrato continuam no cálculo', () => {
  const r = separarParaPeca({ contratos: [], descontos: [{ competencia: '2022-01', valor: 100, contrato: 'A' }], salvos: [], peca: pecaItau });
  assert.strictEqual(r.descontos.length, 1);
});

test('separarParaPeca: caso sem réu cadastrado nem no título usa os contratos lidos e avisa', () => {
  const r = separarParaPeca({ contratos: [ct('1', 'rmc', 'Banco Pan')], descontos: [], salvos: [], peca: { casos: [{ id: 1, titulo: 'RMC' }], reus: [] } });
  assert.deepStrictEqual(r.entram.map((c) => c.numero), ['1']);
  assert.ok(r.avisos.some((a) => /parte contrária/i.test(a)));
});

test('inventarioDaPeca: agrupa por banco e diz, para cada contrato, se entra nesta peça e por quê', () => {
  const pan = ct('766659645-2', 'emprestimo_consignado', 'BANCO PAN S.A.');
  const facta = ct('0059967160', 'rmc', 'FACTA FINANCEIRA S.A.');
  const itau = ct('123456', 'emprestimo_consignado', 'ITAU CONSIGNADO S.A.');
  const salvos = [
    { id: 1, chave: chaveContrato(pan), case_id: null, fora: false, dados: pan },
    { id: 2, chave: chaveContrato(facta), case_id: 33, fora: false, dados: facta },
    { id: 3, chave: chaveContrato(itau), case_id: null, fora: false, dados: itau },
  ];
  const inv = inventarioDaPeca(salvos, pecaItau);
  assert.deepStrictEqual(inv.grupos.map((g) => g.banco), ['ITAU CONSIGNADO S.A.', 'BANCO PAN S.A.', 'FACTA FINANCEIRA S.A.']);
  assert.strictEqual(inv.grupos[0].doReu, true);
  const porNumero = Object.fromEntries(inv.grupos.flatMap((g) => g.contratos).map((c) => [c.numero, c]));
  assert.strictEqual(porNumero['123456'].entra, true);
  assert.strictEqual(porNumero['123456'].origem, 'automatica');
  assert.strictEqual(porNumero['766659645-2'].entra, false);
  assert.strictEqual(porNumero['0059967160'].entra, false);
  assert.strictEqual(porNumero['0059967160'].origem, 'dra');
  assert.strictEqual(porNumero['0059967160'].nomeTipo, 'Cartão RMC');
  assert.strictEqual(inv.entram, 1);
});

// 31/10/2026: o extrato de empréstimos do INSS traz o nome jurídico ("BANCO DO ESTADO DO RIO GRANDE
// DO SUL S.A."), e a ação, o nome conhecido ("Banco Banrisul S.A."). Antes, todo "Banco do Estado
// de ..." virava "estado": Banrisul, Banese e Banpará eram tratados como o mesmo banco.
test('mesmoBanco: nome jurídico do extrato = nome conhecido da ação; bancos estaduais não se confundem', () => {
  assert.ok(mesmoBanco('BANCO DO ESTADO DO RIO GRANDE DO SUL S.A.', 'Banco Banrisul S.A.'));
  assert.ok(mesmoBanco('BANCO DO ESTADO DE SERGIPE S.A.', 'Banese'));
  assert.ok(mesmoBanco('BANCO DO ESTADO DO PARA S.A.', 'Banpará'));
  assert.ok(mesmoBanco('BANCO DE BRASILIA S.A.', 'BRB - Banco de Brasília'));
  assert.ok(mesmoBanco('BANCO DO NORDESTE DO BRASIL S.A.', 'BNB'));
  assert.ok(mesmoBanco('BANCO COOPERATIVO SICREDI S.A.', 'Sicredi'));
  assert.ok(mesmoBanco('CAIXA ECONOMICA FEDERAL', 'Caixa'));
  assert.ok(!mesmoBanco('BANCO DO ESTADO DO RIO GRANDE DO SUL S.A.', 'BANCO DO ESTADO DE SERGIPE S.A.'));
  assert.ok(!mesmoBanco('BANCO DO ESTADO DO PARA S.A.', 'Banco Banrisul S.A.'));
  assert.ok(!mesmoBanco('BANCO COOPERATIVO SICREDI S.A.', 'BANCO COOPERATIVO SICOOB S.A.'));
  assert.ok(!mesmoBanco('Banco do Brasil', 'BANCO DO NORDESTE DO BRASIL S.A.'));
});
