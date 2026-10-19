// tests/partesContrato.test.mjs — contrato com mais de um contratante (ex.: casal no mesmo processo)
import { test } from 'node:test';
import assert from 'node:assert';
import { parsePessoas, separarPartes, paraParte, aplicarCoContratantes, promptPessoasDaConversa } from '../dist/services/partesContrato.js';
import { buildTemplate, buildProcuracao, buildDeclaracao, qualificacaoDaParte } from '../dist/services/contractTemplates.js';

const RESPOSTA_IA = JSON.stringify({ pessoas: [
  { nome: 'Maria Aparecida Teste', cpf: '52998224725', rg: '1234567', estado_civil: 'Casada', relacao: 'titular', email: 'Maria@Teste.com' },
  { nome: 'José Carlos Teste', cpf: '111.444.777-35', rg: '7654321', estado_civil: 'Casado', relacao: 'conjuge' },
  { nome: 'Dra. Letícia Elias Barros', cpf: null },
  { nome: 'Maria Aparecida Teste', cpf: '529.982.247-25' },
] });

test('parsePessoas: formata CPF, valida, tira a advogada e junta repetidos', () => {
  const p = parsePessoas(RESPOSTA_IA);
  assert.deepStrictEqual(p.map((x) => x.nome), ['Maria Aparecida Teste', 'José Carlos Teste']);
  assert.strictEqual(p[0].cpf, '529.982.247-25');
  assert.strictEqual(p[0].cpfValido, true);
  assert.strictEqual(p[0].email, 'maria@teste.com');
  assert.strictEqual(p[1].cpfValido, true);
  assert.deepStrictEqual(parsePessoas('nada'), []);
});

test('separarPartes: o titular é quem tem o CPF (ou o nome) do cliente; o resto são os outros contratantes', () => {
  const pessoas = parsePessoas(RESPOSTA_IA);
  const porCpf = separarPartes({ nome: 'Maria A. Teste', cpf: '529.982.247-25' }, pessoas);
  assert.strictEqual(porCpf.titular.nome, 'Maria Aparecida Teste');
  assert.deepStrictEqual(porCpf.outros.map((x) => x.nome), ['José Carlos Teste']);
  const porNome = separarPartes({ nome: 'Maria Aparecida Teste', cpf: null }, pessoas);
  assert.strictEqual(porNome.titular.nome, 'Maria Aparecida Teste');
  const ninguem = separarPartes({ nome: 'Outra Pessoa', cpf: '000' }, pessoas);
  assert.strictEqual(ninguem.titular, null);
  assert.strictEqual(ninguem.outros.length, 2);
});

test('aplicarCoContratantes: contrato trabalhista vira dos dois, com as duas assinaturas', () => {
  const titular = { name: 'Maria Aparecida Teste', cpf: '529.982.247-25', profissao: 'auxiliar', endereco: 'Rua A, 1, Vitória/ES', email: 'maria@teste.com' };
  const contrato = buildTemplate({ party: titular, area: 'trabalhista', value: 2500 });
  const jose = paraParte({ nome: 'José Carlos Teste', cpf: '111.444.777-35', profissao: 'motorista' });
  const r = aplicarCoContratantes(contrato, [{ qualificacao: qualificacaoDaParte(jose), nome: jose.name, cpf: jose.cpf }]);
  assert.strictEqual(r.alterado, true);
  assert.match(r.texto, /^CONTRATANTES: Maria Aparecida Teste,.*; e José Carlos Teste, brasileiro\(a\), motorista, inscrito\(a\) no CPF nº 111\.444\.777-35.*doravante denominados, em conjunto, CONTRATANTE\.$/m);
  assert.doesNotMatch(r.texto, /^CONTRATANTE: /m);
  const assinaturas = r.texto.match(/_{10,}\n[^\n]+\nCONTRATANTE\nCPF nº [^\n]+/g);
  assert.deepStrictEqual(assinaturas.map((a) => a.split('\n')[1]), ['Maria Aparecida Teste', 'José Carlos Teste']);
  assert.ok(r.texto.indexOf('José Carlos Teste\nCONTRATANTE') < r.texto.indexOf('\nCONTRATADA\n'), 'antes da assinatura da advogada');
});

test('aplicarCoContratantes: outras áreas também; sem extras não mexe', () => {
  const titular = { name: 'Maria Aparecida Teste', cpf: '529.982.247-25' };
  for (const area of ['civel', 'previdenciario', 'consumidor']) {
    const r = aplicarCoContratantes(buildTemplate({ party: titular, area }), [{ qualificacao: 'José Carlos Teste, brasileiro(a)', nome: 'José Carlos Teste', cpf: '111.444.777-35' }]);
    assert.strictEqual(r.alterado, true, area);
    assert.match(r.texto, /José Carlos Teste\nCONTRATANTE\nCPF nº 111\.444\.777-35/, area);
  }
  const texto = buildTemplate({ party: titular, area: 'trabalhista' });
  assert.deepStrictEqual(aplicarCoContratantes(texto, []), { texto, alterado: false });
});

test('cada contratante tem a própria procuração e a própria declaração', () => {
  const jose = paraParte({ nome: 'José Carlos Teste', cpf: '111.444.777-35' });
  const proc = buildProcuracao(jose);
  const decl = buildDeclaracao(jose, { trabalhista: true });
  assert.match(proc, /OUTORGANTE: José Carlos Teste/);
  assert.doesNotMatch(proc, /Maria/);
  assert.match(decl, /Eu, José Carlos Teste/);
  assert.match(decl, /790/, 'trabalhista usa a CLT');
});

test('prompt pede todas as pessoas e exclui advogada e parte contrária', () => {
  const p = promptPessoasDaConversa(['Maria, CPF 1; José, CPF 2']);
  assert.match(p, /TODAS as pessoas/);
  assert.match(p, /parte contrária/);
});
