-- Migration 098 — Integração Asaas (boleto + cartão com confirmação automática)
-- PIX estático (pixService.ts) não muda. Isso é uma opção adicional, escolhida
-- na proposta, que gera cobrança real no Asaas e confirma pagamento via webhook.

ALTER TABLE clients
  ADD COLUMN asaas_customer_id VARCHAR(60) NULL;

ALTER TABLE propostas
  ADD COLUMN payment_gateway_method ENUM('pix','asaas_boleto','asaas_cartao_avista','asaas_cartao_recorrente') NOT NULL DEFAULT 'pix',
  ADD COLUMN payment_consent_at DATETIME NULL;

ALTER TABLE payments
  MODIFY COLUMN method ENUM('pix_manual','mercadopago','asaas_boleto','asaas_cartao_avista','asaas_cartao_recorrente') NOT NULL DEFAULT 'pix_manual',
  ADD COLUMN asaas_subscription_id VARCHAR(60) NULL;
