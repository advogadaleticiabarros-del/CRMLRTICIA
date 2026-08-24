// tests/asaasInvoiceUrl.test.mjs
// Achado I3: createAsaasCharge/createAsaasSubscription devolvem invoiceUrl (o
// link de pagamento do Asaas), mas até agora POST /:id/accept só persistia
// charge.id — o link nunca chegava ao cliente. Confirma que a migration nova
// existe, que a coluna é gravada no INSERT de payments, e que o frontend
// mostra o link na tela de detalhe da proposta.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('migration 099 adiciona payments.invoice_url', () => {
  const file = path.resolve('migrations/099_asaas_invoice_url.sql');
  assert.ok(fs.existsSync(file), 'migrations/099_asaas_invoice_url.sql não encontrada');
  const sql = fs.readFileSync(file, 'utf8');
  assert.match(sql, /ALTER TABLE payments/i);
  assert.match(sql, /ADD COLUMN invoice_url VARCHAR\(255\) NULL/i);
});

test('nenhuma outra migration já usa o número 099 (evita colisão sequencial)', () => {
  const dir = path.resolve('migrations');
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('099_'));
  assert.equal(files.length, 1, `esperado exatamente 1 arquivo 099_*, achou: ${files.join(', ')}`);
});

test('POST /:id/accept grava invoice_url ao criar payments (boleto/cartão avulso e assinatura)', () => {
  const src = fs.readFileSync(path.resolve('src/routes/propostas.ts'), 'utf8');
  const m = src.match(/router\.post\('\/:id\/accept'[\s\S]*?\n\}\);/);
  assert.match(m[0], /charge\.invoiceUrl/, 'a cobrança avulsa precisa gravar charge.invoiceUrl');
  assert.match(m[0], /sub\.invoiceUrl/, 'a assinatura recorrente precisa gravar sub.invoiceUrl');
});

test('GET /api/propostas/:id expõe invoice_url por parcela (para o frontend mostrar o link)', () => {
  const src = fs.readFileSync(path.resolve('src/routes/propostas.ts'), 'utf8');
  const m = src.match(/router\.get\('\/:id'[\s\S]*?\n\}\);/);
  assert.ok(m, 'rota GET /:id não encontrada');
  assert.match(m[0], /invoice_url/, 'a resposta de detalhe da proposta precisa incluir invoice_url por parcela');
});

test('propostaDetail (frontend) exibe o link de pagamento quando a parcela tem invoice_url', () => {
  const src = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
  const m = src.match(/async function propostaDetail[\s\S]*?\n\}/);
  assert.ok(m, 'propostaDetail não encontrada');
  assert.match(m[0], /invoice_url/, 'a tela de detalhe da proposta precisa exibir o link de pagamento (invoice_url) das parcelas');
});
