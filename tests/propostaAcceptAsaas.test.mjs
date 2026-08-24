// tests/propostaAcceptAsaas.test.mjs
// Confirma que a rota de aceite de proposta consulta payment_gateway_method
// e, quando diferente de 'pix', cria a cobrança no Asaas para cada parcela
// (ou uma assinatura só, na primeira, se for cartao_recorrente).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('POST /:id/accept consulta payment_gateway_method da proposta', () => {
  const src = fs.readFileSync(path.resolve('src/routes/propostas.ts'), 'utf8');
  const m = src.match(/router\.post\('\/:id\/accept'[\s\S]*?\n\}\);/);
  assert.ok(m, 'rota /:id/accept não encontrada');
  assert.match(m[0], /payment_gateway_method/, 'a rota precisa ler o campo payment_gateway_method da proposta aceita');
});

test('POST /:id/accept usa createAsaasSubscription só uma vez para cartao_recorrente, não por parcela', () => {
  const src = fs.readFileSync(path.resolve('src/routes/propostas.ts'), 'utf8');
  const m = src.match(/router\.post\('\/:id\/accept'[\s\S]*?\n\}\);/);
  assert.match(m[0], /createAsaasSubscription/, 'falta a chamada de assinatura recorrente');
  const forIdx = m[0].indexOf('for (let i = 0; i < installmentsCount');
  const subIdx = m[0].indexOf('createAsaasSubscription');
  assert.ok(forIdx > -1 && subIdx > -1);
  assert.ok(subIdx < forIdx, 'a criação da assinatura recorrente deve ficar ANTES do loop de parcelas, para rodar uma vez só');
});

test('POST /:id/accept cria cobrança avulsa (boleto/cartão à vista) dentro do loop com provider_txn_id', () => {
  const src = fs.readFileSync(path.resolve('src/routes/propostas.ts'), 'utf8');
  const m = src.match(/router\.post\('\/:id\/accept'[\s\S]*?\n\}\);/);
  assert.match(m[0], /createAsaasCharge/, 'falta a chamada de cobrança avulsa');
  assert.match(m[0], /provider_txn_id/, 'a linha de payments precisa gravar provider_txn_id para o webhook casar a confirmação');
  assert.match(m[0], /asaas_boleto/);
  assert.match(m[0], /asaas_cartao_avista/);
});

test('POST /:id/accept usa a coluna real cpf_cnpj da tabela clients (não "cpf")', () => {
  const src = fs.readFileSync(path.resolve('src/routes/propostas.ts'), 'utf8');
  const m = src.match(/router\.post\('\/:id\/accept'[\s\S]*?\n\}\);/);
  assert.match(m[0], /cpf_cnpj/, 'clients não tem coluna "cpf", só "cpf_cnpj" — ver migrations/001_base_schema.sql');
});
