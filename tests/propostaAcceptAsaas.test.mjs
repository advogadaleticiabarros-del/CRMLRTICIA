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
  const subIdx = m[0].indexOf('createAsaasSubscription(');
  // Fase 2 (pós-commit): a assinatura é criada uma vez, FORA de qualquer loop
  // de parcelas — depois, um loop simples "for (const inst of createdInstallments)"
  // grava um payments por parcela reaproveitando o mesmo asaas_subscription_id.
  const loopInstIdx = m[0].indexOf('for (const inst of createdInstallments)');
  assert.ok(subIdx > -1 && loopInstIdx > -1);
  assert.ok(subIdx < loopInstIdx, 'a criação da assinatura recorrente deve rodar ANTES do loop que grava payments por parcela, para rodar uma vez só');
});

test('POST /:id/accept faz Fase 1 (parcelas, dentro da transação) sem nenhuma chamada de rede ao Asaas', () => {
  const src = fs.readFileSync(path.resolve('src/routes/propostas.ts'), 'utf8');
  const m = src.match(/router\.post\('\/:id\/accept'[\s\S]*?\n\}\);/);
  const commitIdx = m[0].indexOf('await conn.commit()');
  assert.ok(commitIdx > -1, 'a Fase 1 precisa commitar a transação antes de qualquer chamada Asaas');
  const fase1 = m[0].slice(0, commitIdx);
  assert.doesNotMatch(fase1, /ensureAsaasCustomer|createAsaasCharge|createAsaasSubscription/,
    'nenhuma chamada de rede ao Asaas pode acontecer dentro da transação (Fase 1) — trava o pool de conexões se o Asaas estiver lento');
  assert.match(fase1, /INSERT INTO installments/, 'a Fase 1 precisa criar as parcelas');
});

test('POST /:id/accept faz a Fase 2 (chamadas Asaas) fora da transação, depois do commit', () => {
  const src = fs.readFileSync(path.resolve('src/routes/propostas.ts'), 'utf8');
  const m = src.match(/router\.post\('\/:id\/accept'[\s\S]*?\n\}\);/);
  const commitIdx = m[0].indexOf('await conn.commit()');
  const fase2 = m[0].slice(commitIdx);
  assert.match(fase2, /ensureAsaasCustomer/, 'ensureAsaasCustomer deve rodar na Fase 2, após o commit');
  assert.match(fase2, /createAsaasCharge|createAsaasSubscription/);
});

test('POST /:id/accept chama ensureAsaasCustomer só UMA vez (não duplica SELECT de clients + ensureAsaasCustomer por parcela)', () => {
  const src = fs.readFileSync(path.resolve('src/routes/propostas.ts'), 'utf8');
  const m = src.match(/router\.post\('\/:id\/accept'[\s\S]*?\n\}\);/);
  const ocorrencias = (m[0].match(/ensureAsaasCustomer\(/g) || []).length;
  assert.equal(ocorrencias, 1, 'ensureAsaasCustomer deve ser chamado uma única vez, reaproveitado para todas as parcelas');
});

test('POST /:id/accept grava a Fase 2 usando o pool global db (não a conn da transação já fechada)', () => {
  const src = fs.readFileSync(path.resolve('src/routes/propostas.ts'), 'utf8');
  const m = src.match(/router\.post\('\/:id\/accept'[\s\S]*?\n\}\);/);
  const commitIdx = m[0].indexOf('await conn.commit()');
  const fase2 = m[0].slice(commitIdx);
  assert.doesNotMatch(fase2, /conn\.query/, 'a Fase 2 roda depois de conn.release() — não pode usar mais a conexão da transação');
  assert.match(fase2, /db\.query/, 'a Fase 2 precisa usar o pool global db');
});

test('POST /:id/accept cria cobrança avulsa (boleto/cartão à vista) com provider_txn_id e invoice_url', () => {
  const src = fs.readFileSync(path.resolve('src/routes/propostas.ts'), 'utf8');
  const m = src.match(/router\.post\('\/:id\/accept'[\s\S]*?\n\}\);/);
  assert.match(m[0], /createAsaasCharge/, 'falta a chamada de cobrança avulsa');
  assert.match(m[0], /provider_txn_id/, 'a linha de payments precisa gravar provider_txn_id para o webhook casar a confirmação');
  assert.match(m[0], /invoice_url/, 'a linha de payments precisa gravar invoice_url (link de pagamento) — Achado I3');
  assert.match(m[0], /asaas_boleto/);
  assert.match(m[0], /asaas_cartao_avista/);
});

test('POST /:id/accept usa a coluna real cpf_cnpj da tabela clients (não "cpf")', () => {
  const src = fs.readFileSync(path.resolve('src/routes/propostas.ts'), 'utf8');
  const m = src.match(/router\.post\('\/:id\/accept'[\s\S]*?\n\}\);/);
  assert.match(m[0], /cpf_cnpj/, 'clients não tem coluna "cpf", só "cpf_cnpj" — ver migrations/001_base_schema.sql');
});
