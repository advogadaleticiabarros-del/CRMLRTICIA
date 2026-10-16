// tests/copilotoComercial.test.mjs — Dr. Otávio: qualificação em % (capacidade de contratar) e copiloto da Dra. nas conversas
import { test } from 'node:test';
import assert from 'node:assert';
import {
  detectarIntencaoProposta, calcularCapacidade, PERGUNTAS_SUTIS, parseSinais, perguntasQueFaltam, mensagemCopiloto,
  parseSugestaoCopiloto, interpretarComandoMontar, linhaCapacidade,
} from '../dist/services/copilotoComercial.js';
import { mensagemAprovacao } from '../dist/services/esteiraComercial.js';

const m = (from_me, body, humano = true) => ({ from_me, body, humano });

test('detectarIntencaoProposta: cliente pergunta valor ou quer contratar', () => {
  for (const frase of ['Quanto custa pra entrar com a ação?', 'Qual o valor dos honorários?', 'Como funciona o pagamento?', 'Quero contratar a Dra.', 'Dá pra parcelar?']) {
    const r = detectarIntencaoProposta([m(1, 'Oi, tudo bem?'), m(0, frase)]);
    assert.ok(r.intencao, frase);
    assert.strictEqual(r.quem, 'cliente');
  }
});

test('detectarIntencaoProposta: a Dra. fala em mandar a proposta', () => {
  const r = detectarIntencaoProposta([m(0, 'Entendi, Dra.'), m(1, 'Vou montar a sua proposta e te mando hoje')]);
  assert.ok(r.intencao);
  assert.strictEqual(r.quem, 'escritorio');
});

test('detectarIntencaoProposta: mensagem automática do escritório não conta; conversa comum também não', () => {
  assert.strictEqual(detectarIntencaoProposta([m(1, 'Segue a sua proposta de honorários', false)]).intencao, false);
  assert.strictEqual(detectarIntencaoProposta([m(0, 'Bom dia'), m(1, 'Bom dia! Como posso ajudar?'), m(0, 'Fui demitido ontem')]).intencao, false);
  assert.strictEqual(detectarIntencaoProposta([]).intencao, false);
});

test('detectarIntencaoProposta: só olha o fim da conversa (intenção antiga não volta)', () => {
  const lista = [m(0, 'quanto custa?'), ...Array.from({ length: 12 }, (_, i) => m(i % 2, `mensagem ${i}`))];
  assert.strictEqual(detectarIntencaoProposta(lista).intencao, false);
});

test('calcularCapacidade: CLT com boa renda e verbas a receber = alta capacidade', () => {
  const r = calcularCapacidade({ situacao_trabalho: 'empregado_clt', renda_mensal: 4500, verbas_a_receber: true, valor_estimado_causa: 30000, urgencia_dor: 'alta', decisor: true, engajamento: 'alto', preferencia_pagamento: 'cartao' });
  assert.ok(r.capacidade >= 75, `capacidade ${r.capacidade}`);
  assert.ok(r.potencial >= 70, `potencial ${r.potencial}`);
  assert.ok(r.fechamento >= 70, `fechamento ${r.fechamento}`);
  assert.strictEqual(r.faixa, 'alta');
  assert.match(r.modalidade, /entrada/i);
  assert.ok(r.confianca >= 0.9);
});

test('calcularCapacidade: desempregado sem renda, causa boa = só êxito', () => {
  const r = calcularCapacidade({ situacao_trabalho: 'desempregado', renda_mensal: 0, verbas_a_receber: false, valor_estimado_causa: 40000, preferencia_pagamento: 'so_exito' });
  assert.ok(r.capacidade < 40, `capacidade ${r.capacidade}`);
  assert.ok(r.potencial >= 60);
  assert.match(r.modalidade, /êxito/i);
});

test('calcularCapacidade: causa pequena e baixa capacidade = baixa chance', () => {
  const r = calcularCapacidade({ situacao_trabalho: 'informal', renda_mensal: 1200, valor_estimado_causa: 2000, objecao_preco: true, engajamento: 'baixo' });
  assert.strictEqual(r.faixa, 'baixa');
  assert.ok(r.motivos.length >= 2);
});

test('calcularCapacidade: sem sinais = meio-termo com confiança baixa e as perguntas que faltam', () => {
  const r = calcularCapacidade({});
  assert.ok(r.capacidade >= 40 && r.capacidade <= 60);
  assert.ok(r.confianca < 0.2);
  assert.ok(r.faltam.includes('situacao_trabalho') && r.faltam.includes('renda_mensal'));
  const ps = perguntasQueFaltam(r, 2);
  assert.strictEqual(ps.length, 2);
  for (const p of ps) assert.ok(Object.values(PERGUNTAS_SUTIS).includes(p));
});

test('perguntas sutis: simples e sem falar de valor de honorários', () => {
  for (const p of Object.values(PERGUNTAS_SUTIS)) {
    assert.ok(p.length < 160, p);
    assert.doesNotMatch(p, /R\$|honor[aá]rio|quanto (pode|consegue) pagar|tem dinheiro/i, p);
  }
});

test('parseSinais: normaliza a extração da IA', () => {
  const s = parseSinais('```json\n{"situacao_trabalho":"empregado_clt","renda_mensal":"R$ 2.300","verbas_a_receber":true,"valor_estimado_causa":"15 mil","urgencia_dor":"alta","decisor":null,"engajamento":"medio","preferencia_pagamento":"xyz","objecao_preco":false,"mora_fora":false}\n```');
  assert.strictEqual(s.situacao_trabalho, 'empregado_clt');
  assert.strictEqual(s.renda_mensal, 2300);
  assert.strictEqual(s.valor_estimado_causa, 15000);
  assert.strictEqual(s.preferencia_pagamento, null);
  assert.strictEqual(s.decisor, null);
  assert.deepStrictEqual(parseSinais('nada'), {});
});

test('mensagemCopiloto: avisa a Dra. com a %, a sugestão de valores, a próxima mensagem e o comando', () => {
  const cap = calcularCapacidade({ situacao_trabalho: 'empregado_clt', renda_mensal: 3000, valor_estimado_causa: 20000 });
  const t = mensagemCopiloto({
    nome: 'Fulano Teste', leadId: 45, area: 'trabalhista', gatilho: 'quanto custa?', quem: 'cliente', cap,
    sugestao: { total: 1500, entrada: 300, parcelas: 4, valorParcela: 300, exito: 30, origem: 'historico' },
    proximaMensagem: 'Oi, Fulano! Vou preparar a sua proposta.', pontos: ['Ele tem verbas a receber'],
  });
  assert.match(t, /Fulano Teste/);
  assert.match(t, /\d+%/);
  assert.match(t, /R\$ 1\.500,00/);
  assert.match(t, /4x de R\$ 300,00/);
  assert.match(t, /montar proposta 45/);
  assert.match(t, /Oi, Fulano!/);
  const semLead = mensagemCopiloto({ nome: '+5527999990000', leadId: null, area: null, gatilho: 'qual o valor', quem: 'cliente', cap, sugestao: null, proximaMensagem: '', pontos: [] });
  assert.match(semLead, /cadastr/i);
  assert.doesNotMatch(semLead, /montar proposta/);
});

test('parseSugestaoCopiloto e comando "montar proposta N"', () => {
  const s = parseSugestaoCopiloto('{"proxima_mensagem":"Oi!","pontos":["a","b"]}');
  assert.strictEqual(s.proxima_mensagem, 'Oi!');
  assert.deepStrictEqual(s.pontos, ['a', 'b']);
  assert.deepStrictEqual(parseSugestaoCopiloto('x'), { proxima_mensagem: '', pontos: [] });
  assert.strictEqual(interpretarComandoMontar('montar proposta 45'), 45);
  assert.strictEqual(interpretarComandoMontar('Montar a proposta nº 12'), 12);
  assert.strictEqual(interpretarComandoMontar('aprovar 12'), null);
});

test('Lívia: a pergunta sutil entra no prompt só quando existe', async () => {
  const { montarPromptAtendente } = await import('../dist/services/atendente.js');
  const base = { guia: '', correcoes: [], contato: { tipo: 'novo', nome: null, area: null, processos: [] }, conversa: ['Cliente: oi'], perguntas: ['Quando foi?'] };
  assert.match(montarPromptAtendente({ ...base, perguntaSutil: PERGUNTAS_SUTIS.situacao_trabalho }), /PERGUNTA SUTIL[\s\S]*trabalhando em algum lugar/);
  assert.doesNotMatch(montarPromptAtendente(base), /PERGUNTA SUTIL/);
});

test('linhaCapacidade e mensagemAprovacao: a % aparece para a Dra. aprovar', () => {
  const cap = calcularCapacidade({ situacao_trabalho: 'empregado_clt', renda_mensal: 3000 });
  assert.match(linhaCapacidade(cap), /Chance de fechar: \d+%/);
  const t = mensagemAprovacao({ id: 9, nome: 'Fulana', area: 'trabalhista', tipoCausa: null, resumo: null, exito: 30,
    parcelamento: { total: 0, entrada: 0, parcelas: 0, valor_parcela: 0, ultima_parcela: 0 }, origem: 'padrao', capacidade: linhaCapacidade(cap) });
  assert.match(t, /Chance de fechar/);
});
