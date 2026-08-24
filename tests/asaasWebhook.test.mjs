// tests/asaasWebhook.test.mjs
// A rota do webhook confia no token de assinatura no header 'asaas-access-token'
// (configurado no painel do Asaas ao cadastrar a URL do webhook) — comparação
// simples de string, mesmo padrão do webhook do WhatsApp (token no payload).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('rota do webhook do Asaas valida o token antes de processar', () => {
  const src = fs.readFileSync(path.resolve('src/routes/asaas-webhook.ts'), 'utf8');
  assert.match(src, /asaas-access-token/i, 'deve validar o header de assinatura do webhook');
  assert.match(src, /confirmarPagamento/, 'deve reutilizar a função de confirmação existente, não duplicar a lógica');
});

test('webhook do Asaas tem fallback por asaas_subscription_id para cartão recorrente', () => {
  // Cobrança avulsa de assinatura recorrente: payment.id (id da cobrança) nunca
  // bate com provider_txn_id (que fica NULL nesse caso — o que é gravado ali é o
  // id da assinatura, em asaas_subscription_id). Sem fallback por payment.subscription,
  // cartão recorrente nunca confirma automaticamente.
  const src = fs.readFileSync(path.resolve('src/routes/asaas-webhook.ts'), 'utf8');
  assert.match(src, /payment\.subscription/, 'deve tratar payment.subscription como fallback quando provider_txn_id não casa');
  assert.match(src, /asaas_subscription_id/, 'deve casar o fallback pela coluna asaas_subscription_id');
  assert.match(
    src,
    /asaas_subscription_id\s*=\s*\?\s*AND\s*status\s*=\s*'em_processamento'/,
    'o fallback só pode confirmar parcelas ainda pendentes (em_processamento) — nunca reprocessar mensalidades já pagas de meses anteriores da mesma assinatura'
  );
});

test('app.ts monta a rota do webhook do Asaas sob /api/public, sem authenticate', () => {
  const src = fs.readFileSync(path.resolve('src/app.ts'), 'utf8');
  // O projeto já monta outras rotas públicas assim: app.use('/api/public', algumaRoutes);
  // (ver whatsappWebhookRoutes, signPublicRoutes) — sem "authenticate" no meio, porque
  // esse bloco inteiro de /api/public nunca leva o middleware de sessão.
  const linha = src.split('\n').find((l) => l.includes('asaasWebhookRoutes') && l.includes("app.use"));
  assert.ok(linha, 'rota do webhook do Asaas não está montada em app.ts');
  assert.doesNotMatch(linha, /authenticate/, 'a rota pública do webhook não pode exigir authenticate — o Asaas não faz login no CRM');
  assert.match(linha, /\/api\/public/, 'deve ficar no mesmo bloco público das outras rotas (whatsapp webhook, sign-public)');
});
