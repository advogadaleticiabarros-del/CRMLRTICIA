// tests/leisPesquisa.test.mjs — Dra. Júlia (fundamentos para a peça) e Dra. Vera (conferência), com IA simulada
import { test } from 'node:test';
import assert from 'node:assert';
import { abrirAcervo } from '../dist/services/leisAcervo.js';
import { criarPesquisa, lerJsonDaIa } from '../dist/services/leisPesquisa.js';

const cab = (c) => '---\n' + Object.entries(c).map(([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : v}`).join('\n') + '\n---\n';
function acervo() {
  const a = abrirAcervo(':memory:');
  a.indexarArquivo('federal/decretos-lei/1943/del-5452-1943-05-01.md', cab({ titulo: 'Decreto-Lei nº 5.452 de 01/05/1943', tipo: 'Decreto-Lei', numero: '5452', data: '1943-05-01', fonte: 'https://normas.leg.br/clt' })
    + '# CLT\n\n**Art. 477.** Na extinção do contrato, o empregador pagará as verbas rescisórias em dez dias.\n\n**Art. 482.** Constituem justa causa: i) abandono de emprego.\n');
  a.indexarArquivo('federal/leis-ordinarias/1991/lei-8213-1991-07-24.md', cab({ titulo: 'Lei nº 8.213 de 24/07/1991', tipo: 'Lei Ordinária', numero: '8213', data: '1991-07-24', fonte: 'https://normas.leg.br/8213' })
    + '# Lei\n\n**Art. 42.** A aposentadoria por invalidez será devida ao segurado incapaz.\n');
  a.indexarArquivo('jurisprudencia/tst/sumulas/sumula-331.md', cab({ titulo: 'Súmula nº 331 do TST', tribunal: 'TST', tipo: 'Súmula', numero: '331', data: '2011-05-31', fonte: 'https://tst/331' })
    + '# Súmula nº 331 do TST\n\nIV - O inadimplemento das obrigações trabalhistas implica a responsabilidade subsidiária do tomador dos serviços.\n');
  a.indexarArquivo('jurisprudencia/tst/sumulas/sumula-212.md', cab({ titulo: 'Súmula nº 212 do TST', tribunal: 'TST', tipo: 'Súmula', numero: '212', data: '2003-11-21', fonte: 'https://tst/212' })
    + '# Súmula nº 212 do TST\n\nDESPEDIMENTO. ÔNUS DA PROVA. O ônus de provar o término do contrato de trabalho, quando negados a prestação de serviço e o despedimento, é do empregador.\n');
  return a;
}

test('lerJsonDaIa: tira o JSON do meio do texto (cerca ```json, texto antes e depois); lixo → null', () => {
  assert.deepStrictEqual(lerJsonDaIa('Claro!\n```json\n{"a": [1]}\n```\nAbraço'), { a: [1] });
  assert.deepStrictEqual(lerJsonDaIa('[{"i":0}]'), [{ i: 0 }]);
  assert.strictEqual(lerJsonDaIa('não sei'), null);
});

test('fundamentosParaPeca: junta as citações do próprio texto e as sugeridas pela IA, só as que existem, com súmula por tema', async () => {
  const registros = [];
  let promptRecebido = '';
  const p = criarPesquisa({
    acervo: acervo(),
    ia: async (prompt) => { promptRecebido = prompt; return { ok: true, text: '{"dispositivos":["art. 482 da CLT","art. 999 da CLT","Súmula 331 do TST"],"termos":["onus da prova despedimento"]}' }; },
    registrar: (agente, texto) => registros.push([agente, texto]),
  });
  const bloco = await p.fundamentosParaPeca('Intimação: manifestar sobre a defesa que alega abandono de emprego. Pedido do art. 42 da Lei 8.213/91.', { area: 'trabalhista', tipo: 'Réplica' }, 'o Enzo');
  assert.match(bloco, /FUNDAMENTOS LEGAIS CONFERIDOS/);
  assert.match(bloco, /art\. 42 da Lei nº 8\.213\/1991/, 'citação do próprio texto');
  assert.match(bloco, /art\. 482 da CLT/, 'sugerida pela IA e conferida');
  assert.match(bloco, /Súmula nº 331 do TST/);
  assert.match(bloco, /Súmula nº 212 do TST/, 'achada pela busca com os termos');
  assert.doesNotMatch(bloco, /999/, 'artigo inexistente não entra');
  assert.match(promptRecebido, /Réplica/);
  assert.match(promptRecebido, /trabalhista/);
  assert.deepStrictEqual(registros[0][0], 'pesquisador');
  assert.match(registros[0][1], /o Enzo/);
});

test('fundamentosParaPeca: IA fora do ar ou resposta inválida → ainda entrega as citações do texto; sem nada → vazio', async () => {
  const p = criarPesquisa({ acervo: acervo(), ia: async () => ({ ok: false, message: 'sem cota' }), registrar: () => {} });
  assert.match(await p.fundamentosParaPeca('conforme o art. 477 da CLT', {}, 'x'), /art\. 477 da CLT/);
  const p2 = criarPesquisa({ acervo: acervo(), ia: async () => ({ ok: true, text: 'texto solto' }), registrar: () => {} });
  assert.strictEqual(await p2.fundamentosParaPeca('fatos sem nenhuma lei', {}, 'x'), '');
  const p3 = criarPesquisa({ acervo: null, ia: async () => ({ ok: true, text: '{}' }), registrar: () => {} });
  assert.strictEqual(await p3.fundamentosParaPeca('art. 477 da CLT', {}, 'x'), '', 'acervo ainda não baixado');
});

test('conferirPeca: situação de cada citação + a IA diz se o texto oficial sustenta o que a peça afirma', async () => {
  let prompt = '';
  const registros = [];
  const p = criarPesquisa({
    acervo: acervo(),
    ia: async (pr) => { prompt = pr; return { ok: true, text: '[{"i":0,"sustenta":"nao","observacao":"o art. 482 trata de justa causa, não de prazo de pagamento"},{"i":1,"sustenta":"sim"}]' }; },
    registrar: (a, t) => registros.push([a, t]),
  });
  const peca = 'As verbas devem ser pagas em dez dias, nos termos do art. 482 da CLT. O tomador responde subsidiariamente (Súmula 331 do TST). Ver ainda o art. 999 da CLT.';
  const r = await p.conferirPeca(peca);
  assert.strictEqual(r.itens.length, 3);
  assert.strictEqual(r.itens[0].sustenta, 'nao');
  assert.match(r.itens[0].observacao, /justa causa/);
  assert.strictEqual(r.itens[1].sustenta, 'sim');
  assert.strictEqual(r.itens[2].situacao, 'artigo_inexistente');
  assert.strictEqual(r.itens[2].sustenta, undefined, 'só pergunta à IA o que existe');
  assert.match(prompt, /pagas em dez dias/, 'manda à IA o trecho da peça em volta da citação');
  assert.match(prompt, /Constituem justa causa/, 'e o texto oficial');
  assert.match(r.relatorio, /CONFERÊNCIA DAS CITAÇÕES/);
  assert.match(r.relatorio, /NÃO sustenta/);
  assert.deepStrictEqual(r.contagem, { total: 3, confere: 2, problemas: 1, sentido: 1 });
  assert.strictEqual(registros[0][0], 'verificador');
});

test('conferirPeca: sem IA, fica só a conferência por regra (existe, vigente, artigo certo)', async () => {
  const p = criarPesquisa({ acervo: acervo(), ia: async () => ({ ok: false }), registrar: () => {} });
  const r = await p.conferirPeca('nos termos do art. 482 da CLT');
  assert.strictEqual(r.itens[0].situacao, 'confere');
  assert.strictEqual(r.itens[0].sustenta, undefined);
  assert.strictEqual(r.contagem.sentido, 0);
});
