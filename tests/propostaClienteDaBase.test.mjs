// tests/propostaClienteDaBase.test.mjs — nova proposta já encontra o cliente da base
// (pedido de 26/11/2026: cliente que já tem processo conosco e quer entrar com outro).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const ini = app.indexOf('async function propostaForm(');
const fim = app.indexOf('async function propostaDetail(');
const form = app.slice(ini, fim);
const rotaPropostas = fs.readFileSync(new URL('../src/routes/propostas.ts', import.meta.url), 'utf8');
const rotaClientes = fs.readFileSync(new URL('../src/routes/clients.ts', import.meta.url), 'utf8');

test('formulário da proposta busca o cliente na base pela busca tolerante (nome, CPF, telefone, processo)', () => {
  assert.ok(ini > 0 && fim > ini, 'propostaForm encontrado');
  assert.match(form, /\/api\/clients\/busca-360\?q=/);
  assert.match(form, /\/resumo-proposta/, 'ao escolher, traz contatos e processos que o cliente já tem');
  assert.doesNotMatch(form, /\/api\/clients\?limit=2000/, 'não carrega mais a lista inteira de clientes');
});

test('ao digitar nome ou CPF de quem já é cliente, o formulário avisa e oferece usar a ficha', () => {
  assert.match(form, /\[name=contact_name\][\s\S]*\[name=cpf\]|\[name=cpf\][\s\S]*\[name=contact_name\]/);
  assert.match(form, /Usar esta ficha/);
});

test('o vínculo com o cliente da base é enviado e também é salvo ao editar', () => {
  assert.match(form, /client_id:/);
  assert.match(rotaPropostas, /setIf\('client_id'/, 'PUT /api/propostas/:id aceita client_id');
});

test('rota do resumo para a proposta existe e valida o id', () => {
  assert.match(rotaClientes, /router\.get\('\/:id\/resumo-proposta'/);
  assert.match(rotaClientes, /resumoClienteParaProposta/);
});
