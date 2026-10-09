// tests/dadosPropostaConversa.test.mjs — dados da proposta lidos da conversa do WhatsApp
import { test } from 'node:test';
import assert from 'node:assert';
import { lerDadosRotulados, juntarDados, camposParaPreencher } from '../dist/services/dadosPropostaConversa.js';

// mensagem real (07/10/2026): a cliente respondeu em cima do modelo do escritório
const FULANA = `Por favor, me envie as informações abaixo:
- Nome completo: Fulana de Tal Souza
- CPF: 111.444.777-35
- E-mail: cliente.teste@example.com
- Endereço completo: Rua das Flores, 418 escadaria das Flores,  primeiro beco a direita. Bairro Centro, Vitória. CEP 29.000-000

Com essas informações, vou preparar a proposta e te enviar para avaliação.`;

test('lerDadosRotulados: lê nome, CPF, e-mail, CEP e endereço sem IA', () => {
  const d = lerDadosRotulados(FULANA);
  assert.strictEqual(d.nome_completo, 'Fulana de Tal Souza');
  assert.strictEqual(d.cpf, '111.444.777-35');
  assert.strictEqual(d.email, 'cliente.teste@example.com');
  assert.strictEqual(d.cep, '29000-000');
  assert.match(d.endereco, /^Rua das Flores, 418/);
});

test('lerDadosRotulados: CPF solto e e-mail solto também valem; texto sem dado devolve vazio', () => {
  assert.deepStrictEqual(lerDadosRotulados('bom dia, tudo bem?'), {});
  const d = lerDadosRotulados('meu cpf 12345678909 e email fulano@x.com.br');
  assert.strictEqual(d.cpf, '123.456.789-09');
  assert.strictEqual(d.email, 'fulano@x.com.br');
});

test('juntarDados: o que veio rotulado na mensagem vence a IA; IA completa o resto', () => {
  const r = juntarDados({ nome_completo: 'Fulana de Tal Souza', cpf: '111.444.777-35' },
    { nome_completo: 'Fulana', cpf: '', street: 'Rua das Flores', number: '418', city: 'Vitória', state: 'ES' });
  assert.strictEqual(r.nome_completo, 'Fulana de Tal Souza');
  assert.strictEqual(r.cpf, '111.444.777-35');
  assert.strictEqual(r.street, 'Rua das Flores');
  assert.strictEqual(r.state, 'ES');
});

test('camposParaPreencher: só completa o que está vazio no lead — nunca sobrescreve', () => {
  const lead = { cpf_cnpj: null, email: '', street: 'RUA DAS FLORES', number: '416', neighborhood: 'CENTRO', city: 'VITORIA', cep: null, state: null };
  const novos = { cpf: '111.444.777-35', email: 'cliente.teste@example.com', cep: '29000-000', street: 'Rua das Flores', number: '418', city: 'Vitória', state: 'ES' };
  const { preencher, divergencias } = camposParaPreencher(lead, novos);
  assert.deepStrictEqual(preencher, { cpf_cnpj: '111.444.777-35', email: 'cliente.teste@example.com', cep: '29000-000', state: 'ES' });
  // número diferente do que já estava na ficha → avisa, não troca
  assert.deepStrictEqual(divergencias, [{ campo: 'number', ficha: '416', conversa: '418' }]);
});
