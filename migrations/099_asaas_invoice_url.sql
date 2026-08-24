-- Migration 099 — Link de pagamento (invoiceUrl) das cobranças Asaas
-- createAsaasCharge/createAsaasSubscription devolvem invoiceUrl (boleto/cartão)
-- e até agora esse link era descartado — o cliente nunca recebia o link de
-- pagamento pelo CRM. Guarda o link em payments para exibir/enviar depois.

ALTER TABLE payments
  ADD COLUMN invoice_url VARCHAR(255) NULL;
