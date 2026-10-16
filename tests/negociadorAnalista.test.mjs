// tests/negociadorAnalista.test.mjs — Dr. Rafael (objeções, com ética da OAB) e Dra. Helena (análise crítica dos documentos x história)
import { test } from 'node:test';
import assert from 'node:assert';
import {
  detectarObjecoes, GUIA_OBJECOES, MARCHA_PROCESSUAL, REGRAS_ETICAS, montarPromptNegociador, parseRespostaNegociador,
  alertasNegociador, valoresDaProposta, mensagemDraObjecao,
} from '../dist/services/negociador.js';
import {
  parseLeituraCritica, parseFatos, cruzar, relatorioAnalise, mensagemAnaliseDra, pedidosDeReenvio, mensagemReenvio, parseApontamentosIa,
} from '../dist/services/analistaDocumentos.js';

import { AGENTES } from '../dist/services/escritorioVirtual.js';
import { conversaDeAcao } from '../dist/services/sociedadeAgentes.js';

test('escritório: Dr. Rafael e Dra. Helena entram na equipe e conversam com os colegas', () => {
  const ids = AGENTES.map((a) => a.id);
  assert.ok(ids.includes('negociador') && ids.includes('analista'));
  const c = conversaDeAcao({ id: 1, agente: 'negociador', texto: 'preparou resposta à objeção de Fulana Teste na proposta nº 12 (preco)' });
  assert.strictEqual(c.para, 'comercial');
  assert.match(c.falas[0].texto, /Fulana Teste/);
  const d = conversaDeAcao({ id: 2, agente: 'analista', texto: 'analisou 6 documento(s) de Fulana Teste: 2 grave(s), 1 de atenção' });
  assert.strictEqual(d.para, 'coletor');
  assert.match(d.falas[0].texto, /2 ponto\(s\) grave/);
});

// ── Dr. Rafael: objeções ────────────────────────────────────────────────────

test('detectarObjecoes: reconhece as objeções comuns do possível cliente', () => {
  const casos = {
    preco: 'Achei muito caro, não tenho condições agora',
    pensar: 'Vou pensar e depois te falo',
    consultar_alguem: 'Preciso conversar com meu marido antes',
    prazo: 'Quanto tempo demora pra eu receber?',
    garantia: 'Mas eu vou ganhar? Tem certeza?',
    confianca: 'Como sei que não é golpe? Nunca te vi',
    outro_advogado: 'O sindicato faz de graça',
    medo_empresa: 'Tenho medo de represália, ainda trabalho lá',
    custo_se_perder: 'E se eu perder vou ter que pagar as custas?',
  };
  for (const [cat, frase] of Object.entries(casos)) assert.ok(detectarObjecoes(frase).includes(cat), `${cat}: ${frase}`);
  assert.deepStrictEqual(detectarObjecoes('Bom dia, tudo bem? Pode mandar o contrato'), []);
});

test('GUIA_OBJECOES: toda categoria tem o que está por trás, como responder e o que nunca dizer', () => {
  for (const cat of ['preco', 'pensar', 'consultar_alguem', 'prazo', 'garantia', 'confianca', 'outro_advogado', 'medo_empresa', 'custo_se_perder']) {
    const g = GUIA_OBJECOES[cat];
    assert.ok(g && g.rotulo && g.porTras && g.comoResponder && g.nunca, cat);
  }
});

test('marcha processual e regras éticas: processo tem dia para começar, não para terminar; sem promessa', () => {
  assert.match(MARCHA_PROCESSUAL, /dia para começar.*não tem dia para terminar/s);
  const regras = REGRAS_ETICAS.join(' ');
  assert.match(regras, /resultado/i);
  assert.match(regras, /riscos/i);
  assert.match(regras, /desconto/i);
  assert.match(regras, /Provimento 205/);
});

test('montarPromptNegociador: leva as objeções, a proposta aprovada, a marcha processual e as regras', () => {
  const p = montarPromptNegociador({
    guia: 'Tom acolhedor', correcoes: ['Não use "querida"'], objecoes: ['preco', 'prazo'],
    proposta: { id: 12, nome: 'Fulana Teste', area: 'trabalhista', total: 1500, entrada: 300, parcelas: 4, valorParcela: 300, exito: 30, validade: '2026-10-30' },
    conversa: ['Cliente: achei caro', 'Escritório: entendo'],
  });
  assert.match(p, /Dr\. Rafael/);
  assert.match(p, /R\$ 1\.500,00/);
  assert.match(p, /4x de R\$ 300,00/);
  assert.match(p, /30%/);
  assert.match(p, /não tem dia para terminar/);
  assert.match(p, /Não use "querida"/);
  assert.match(p, /Preço|preço/);
  assert.match(p, /desconto/i);
});

test('parseRespostaNegociador: JSON válido; categorias desconhecidas caem fora; sem resposta = null', () => {
  const r = parseRespostaNegociador('```json\n{"resposta":"Entendo você.","objecoes":["preco","xyz"],"pedido_desconto":true,"precisa_dra":false,"motivo_dra":"","temperatura":"morna"}\n```');
  assert.strictEqual(r.resposta, 'Entendo você.');
  assert.deepStrictEqual(r.objecoes, ['preco']);
  assert.strictEqual(r.pedido_desconto, true);
  assert.strictEqual(r.precisa_dra, true, 'pedido de desconto sempre vai para a Dra.');
  assert.strictEqual(r.temperatura, 'morna');
  assert.strictEqual(parseRespostaNegociador('{"resposta":""}'), null);
  assert.strictEqual(parseRespostaNegociador('não é json'), null);
});

test('alertasNegociador: promessa de resultado/prazo, desconto, pressão, colega e valor fora da proposta', () => {
  const ok = valoresDaProposta({ total: 1500, entrada: 300, parcelas: 4 }, 30);
  assert.deepStrictEqual(alertasNegociador('Entendo! A proposta é R$ 1.500,00, com entrada de R$ 300,00 e 4x de R$ 300,00. Êxito de 30% só se ganhar.', ok), []);
  assert.deepStrictEqual(alertasNegociador('O processo tem dia para começar, mas não tem dia para terminar.', ok), []);
  assert.ok(alertasNegociador('Pode ficar tranquila, você vai ganhar', ok).includes('promete resultado'));
  assert.ok(alertasNegociador('Em 6 meses você recebe', ok).includes('promete prazo'));
  assert.ok(alertasNegociador('Sai rápido, não demora', ok).includes('promete prazo'));
  assert.ok(alertasNegociador('Faço um desconto pra você', ok).includes('oferece desconto'));
  assert.ok(alertasNegociador('Essa condição é só hoje!', ok).includes('pressão de venda'));
  assert.ok(alertasNegociador('O sindicato não resolve nada', ok).includes('fala mal de colega'));
  assert.ok(alertasNegociador('Fecho por R$ 1.000,00', ok).includes('valor fora da proposta'));
  assert.ok(alertasNegociador('Êxito de 20%', ok).includes('valor fora da proposta'));
});

test('mensagemDraObjecao: avisa a Dra. com a proposta, as objeções e o comando ajustar', () => {
  const m = mensagemDraObjecao({ id: 12, nome: 'Fulana Teste', objecoes: ['preco'], trecho: 'achei caro', pedidoDesconto: true, motivo: '' });
  assert.match(m, /Fulana Teste/);
  assert.match(m, /nº 12/);
  assert.match(m, /desconto/i);
  assert.match(m, /ajustar 12/);
});

// ── Dra. Helena: análise crítica dos documentos ─────────────────────────────

const leitura = (o) => parseLeituraCritica(JSON.stringify({ legivel: true, completo: true, indicios_alteracao: [], ...o }));
const CADASTRO = { nome: 'Maria Aparecida Teste', cpf: '529.982.247-25' };

test('parseLeituraCritica: normaliza datas, salário e competências do FGTS', () => {
  const l = leitura({
    tipo: 'extrato_fgts', titular: { nome: 'MARIA APARECIDA TESTE', cpf: '52998224725', nascimento: '01/02/1990' },
    empregador: { nome: 'Mercado Exemplo Ltda', cnpj: '11.222.333/0001-81' }, admissao: '10/01/2024', demissao: null,
    salario: 'R$ 1.850,50', competencias_fgts: ['01/2024', '2024-02', '04/2024'],
  });
  assert.strictEqual(l.tipo, 'extrato_fgts');
  assert.strictEqual(l.admissao, '2024-01-10');
  assert.strictEqual(l.salario, 1850.5);
  assert.deepStrictEqual(l.competencias_fgts, ['2024-01', '2024-02', '2024-04']);
  assert.strictEqual(l.titular.nascimento, '1990-02-01');
  assert.strictEqual(parseLeituraCritica('lixo'), null);
});

test('parseFatos: extrai os fatos da história contada', () => {
  const f = parseFatos('{"empresa":"Mercado Exemplo","admissao":"10/01/2024","demissao":"2026-05-31","salario":"2.500","carteira_assinada":true,"gestante":false}');
  assert.strictEqual(f.empresa, 'Mercado Exemplo');
  assert.strictEqual(f.admissao, '2024-01-10');
  assert.strictEqual(f.salario, 2500);
  assert.strictEqual(f.carteira_assinada, true);
});

const hoje = new Date('2026-10-16T12:00:00Z');

test('cruzar: documento ilegível, cortado ou com indício de alteração', () => {
  const a = cruzar({ cadastro: CADASTRO, fatos: {}, hoje, docs: [
    { fonte: 'rg.jpg', l: leitura({ tipo: 'rg', legivel: false }) },
    { fonte: 'ctps.pdf', l: leitura({ tipo: 'ctps', completo: false }) },
    { fonte: 'holerite.pdf', l: leitura({ tipo: 'holerite', indicios_alteracao: ['fonte diferente no valor do salário'] }) },
  ] });
  assert.ok(a.some((x) => x.tema === 'legibilidade' && x.reenvio && x.fontes.includes('rg.jpg')));
  assert.ok(a.some((x) => x.tema === 'documento incompleto' && x.reenvio));
  assert.ok(a.some((x) => x.tema === 'possível alteração' && x.nivel === 'grave'));
});

test('cruzar: nome e CPF diferentes do cadastro são graves; abreviação do nome não', () => {
  const a = cruzar({ cadastro: CADASTRO, fatos: {}, hoje, docs: [
    { fonte: 'cnh.jpg', l: leitura({ tipo: 'cnh', titular: { nome: 'Maria A. Teste', cpf: '529.982.247-25' } }) },
    { fonte: 'ctps.pdf', l: leitura({ tipo: 'ctps', titular: { nome: 'Joana Souza', cpf: '111.444.777-35' } }) },
  ] });
  assert.ok(!a.some((x) => x.tema === 'nome' && x.fontes.includes('cnh.jpg')));
  assert.ok(a.some((x) => x.tema === 'nome' && x.nivel === 'grave' && x.fontes.includes('ctps.pdf')));
  assert.ok(a.some((x) => x.tema === 'CPF' && x.nivel === 'grave'));
});

test('cruzar: comprovante de endereço antigo ou em nome de outra pessoa', () => {
  const a = cruzar({ cadastro: CADASTRO, fatos: {}, hoje, docs: [
    { fonte: 'luz.pdf', l: leitura({ tipo: 'comprovante_endereco', data_emissao: '2026-03-10', titular: { nome: 'José Teste' } }) },
  ] });
  assert.ok(a.some((x) => x.tema === 'comprovante de endereço' && /meses|dias/.test(x.texto) && x.reenvio));
  assert.ok(a.some((x) => x.tema === 'comprovante de endereço' && /outra pessoa|terceiro/.test(x.texto)));
  assert.ok(!a.some((x) => x.tema === 'nome'), 'comprovante em nome de terceiro não é divergência de nome');
});

test('cruzar: empresa, datas, salário e carteira contra a história', () => {
  const fatos = { empresa: 'Supermercado Bom Preço', admissao: '2023-06-01', demissao: '2026-05-31', salario: 2500, carteira_assinada: false };
  const a = cruzar({ cadastro: CADASTRO, fatos, hoje, docs: [
    { fonte: 'ctps.pdf', l: leitura({ tipo: 'ctps', titular: { nome: 'Maria Aparecida Teste' }, empregador: { nome: 'Mercado Exemplo Ltda' }, admissao: '2024-01-10', demissao: '2026-05-31', salario: 1800 }) },
  ] });
  assert.ok(a.some((x) => x.tema === 'empresa' && x.nivel === 'grave'), 'empresa do relato não aparece');
  assert.ok(a.some((x) => x.tema === 'admissão' && /sem carteira|sem registro/.test(x.texto)), 'registro depois da data contada');
  assert.ok(a.some((x) => x.tema === 'salário' && /por fora/.test(x.texto)));
  assert.ok(a.some((x) => x.tema === 'carteira' && x.nivel === 'grave'), 'disse sem carteira, mas a CTPS tem o contrato');
});

test('cruzar: empresa com nome parecido (sem Ltda, maiúsculas) não é divergência', () => {
  const a = cruzar({ cadastro: CADASTRO, fatos: { empresa: 'mercado exemplo' }, hoje, docs: [
    { fonte: 'ctps.pdf', l: leitura({ tipo: 'ctps', titular: { nome: 'Maria Aparecida Teste' }, empregador: { nome: 'MERCADO EXEMPLO LTDA - ME' } }) },
  ] });
  assert.ok(!a.some((x) => x.tema === 'empresa'));
});

test('cruzar: prescrição bienal vencida e prestes a vencer', () => {
  const vencida = cruzar({ cadastro: CADASTRO, fatos: { demissao: '2024-08-01' }, hoje, docs: [] });
  assert.ok(vencida.some((x) => x.tema === 'prescrição' && x.nivel === 'grave' && /2 anos/.test(x.texto)));
  const perto = cruzar({ cadastro: CADASTRO, fatos: { demissao: '2024-12-01' }, hoje, docs: [] });
  assert.ok(perto.some((x) => x.tema === 'prescrição' && x.nivel === 'grave' && /faltam \d+ dias/.test(x.texto)));
  const longe = cruzar({ cadastro: CADASTRO, fatos: { demissao: '2026-05-31' }, hoje, docs: [] });
  assert.ok(!longe.some((x) => x.tema === 'prescrição'));
});

test('cruzar: meses sem depósito de FGTS viram achado favorável', () => {
  const a = cruzar({ cadastro: CADASTRO, fatos: {}, hoje, docs: [
    { fonte: 'fgts.pdf', l: leitura({ tipo: 'extrato_fgts', titular: { nome: 'Maria Aparecida Teste' }, admissao: '2026-01-05', demissao: '2026-05-20', competencias_fgts: ['2026-01', '2026-02', '2026-05'] }) },
  ] });
  const f = a.find((x) => x.tema === 'FGTS');
  assert.ok(f && f.nivel === 'favoravel');
  assert.match(f.texto, /03\/2026/);
  assert.match(f.texto, /04\/2026/);
});

test('cruzar: gestante — gravidez começou antes ou depois da dispensa', () => {
  const antes = cruzar({ cadastro: CADASTRO, fatos: { gestante: true, demissao: '2026-05-31' }, hoje, docs: [
    { fonte: 'ultrassom.pdf', l: leitura({ tipo: 'ultrassom', titular: { nome: 'Maria Aparecida Teste' }, data_exame: '2026-07-01', semanas_gestacao: 12 }) },
  ] });
  assert.ok(antes.some((x) => x.tema === 'gestação' && x.nivel === 'favoravel'));
  const depois = cruzar({ cadastro: CADASTRO, fatos: { gestante: true, demissao: '2026-03-01' }, hoje, docs: [
    { fonte: 'ultrassom.pdf', l: leitura({ tipo: 'ultrassom', titular: { nome: 'Maria Aparecida Teste' }, data_exame: '2026-07-01', semanas_gestacao: 8 }) },
  ] });
  assert.ok(depois.some((x) => x.tema === 'gestação' && x.nivel === 'grave'));
});

test('cruzar: saída antes da entrada é grave', () => {
  const a = cruzar({ cadastro: CADASTRO, fatos: {}, hoje, docs: [
    { fonte: 'ctps.pdf', l: leitura({ tipo: 'ctps', titular: { nome: 'Maria Aparecida Teste' }, admissao: '2025-05-01', demissao: '2024-05-01' }) },
  ] });
  assert.ok(a.some((x) => x.tema === 'datas' && x.nivel === 'grave'));
});

test('relatório, mensagem à Dra. e pedidos de reenvio', () => {
  const achados = cruzar({ cadastro: CADASTRO, fatos: { demissao: '2024-08-01' }, hoje, docs: [
    { fonte: 'rg.jpg', l: leitura({ tipo: 'rg', legivel: false }) },
  ] });
  const rel = relatorioAnalise('Maria Aparecida Teste', achados, [{ fonte: 'rg.jpg', tipo: 'rg' }]);
  assert.match(rel, /Análise dos documentos/);
  assert.match(rel, /rg\.jpg/);
  assert.match(rel, /prescrição/i);
  const m = mensagemAnaliseDra('Maria Aparecida Teste', achados);
  assert.match(m, /🔴/);
  assert.match(m, /Maria Aparecida Teste/);
  const pedidos = pedidosDeReenvio(achados);
  assert.strictEqual(pedidos.length, 1);
  const txt = mensagemReenvio('Maria Aparecida Teste', pedidos);
  assert.match(txt, /Maria/);
  assert.doesNotMatch(txt, /prescri|alteraç|diverg/i, 'ao cliente vai só o pedido neutro de reenvio');
});

test('mensagemAnaliseDra: sem achados relevantes diz que está tudo coerente', () => {
  assert.match(mensagemAnaliseDra('Fulana', []), /coerente|nada/i);
});

test('parseApontamentosIa: lista de contradições extras, marcadas para conferir', () => {
  const a = parseApontamentosIa('{"apontamentos":[{"texto":"Relato diz turno da noite, holerite não tem adicional noturno","fontes":["holerite.pdf"]}]}');
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].nivel, 'atencao');
  assert.match(a[0].texto, /conferir/);
  assert.deepStrictEqual(parseApontamentosIa('x'), []);
});
