// tests/dadosPropostaConversa.test.mjs — dados da proposta lidos da conversa do WhatsApp
import { test } from 'node:test';
import assert from 'node:assert';
import { lerDadosRotulados, juntarDados, camposParaPreencher } from '../dist/services/dadosPropostaConversa.js';

// mensagem real (07/10/2026): a cliente respondeu em cima do modelo do escritório
const MAILZA = `Por favor, me envie as informações abaixo:
- Nome completo: Mailza dos Santos Costa
- CPF: 627.009.015-68
- E-mail: mailza.sc2709@gmail.com
- Endereço completo: Rua Dalmacio Sodré, 418 escadaria Dalmacio Sodré,  primeiro beco a direita. Bairro Santa Tereza, Vitória. CEP 29.026-844

Com essas informações, vou preparar a proposta e te enviar para avaliação.`;

test('lerDadosRotulados: lê nome, CPF, e-mail, CEP e endereço sem IA', () => {
  const d = lerDadosRotulados(MAILZA);
  assert.strictEqual(d.nome_completo, 'Mailza dos Santos Costa');
  assert.strictEqual(d.cpf, '627.009.015-68');
  assert.strictEqual(d.email, 'mailza.sc2709@gmail.com');
  assert.strictEqual(d.cep, '29026-844');
  assert.match(d.endereco, /^Rua Dalmacio Sodré, 418/);
});

test('lerDadosRotulados: CPF solto e e-mail solto também valem; texto sem dado devolve vazio', () => {
  assert.deepStrictEqual(lerDadosRotulados('bom dia, tudo bem?'), {});
  const d = lerDadosRotulados('meu cpf 12345678909 e email fulano@x.com.br');
  assert.strictEqual(d.cpf, '123.456.789-09');
  assert.strictEqual(d.email, 'fulano@x.com.br');
});

test('juntarDados: o que veio rotulado na mensagem vence a IA; IA completa o resto', () => {
  const r = juntarDados({ nome_completo: 'Mailza dos Santos Costa', cpf: '627.009.015-68' },
    { nome_completo: 'Mailza', cpf: '', street: 'Rua Dalmacio Sodré', number: '418', city: 'Vitória', state: 'ES' });
  assert.strictEqual(r.nome_completo, 'Mailza dos Santos Costa');
  assert.strictEqual(r.cpf, '627.009.015-68');
  assert.strictEqual(r.street, 'Rua Dalmacio Sodré');
  assert.strictEqual(r.state, 'ES');
});

test('camposParaPreencher: só completa o que está vazio no lead — nunca sobrescreve', () => {
  const lead = { cpf_cnpj: null, email: '', street: 'ESC DALMACIO SODRE', number: '416', neighborhood: 'SANTA TEREZA', city: 'VITORIA', cep: null, state: null };
  const novos = { cpf: '627.009.015-68', email: 'mailza.sc2709@gmail.com', cep: '29026-844', street: 'Rua Dalmacio Sodré', number: '418', city: 'Vitória', state: 'ES' };
  const { preencher, divergencias } = camposParaPreencher(lead, novos);
  assert.deepStrictEqual(preencher, { cpf_cnpj: '627.009.015-68', email: 'mailza.sc2709@gmail.com', cep: '29026-844', state: 'ES' });
  // número diferente do que já estava na ficha → avisa, não troca
  assert.deepStrictEqual(divergencias, [{ campo: 'number', ficha: '416', conversa: '418' }]);
});
