-- Data em que o e-mail do parceiro CHEGOU no Gmail (23/10/2026, pedido da Jessica:
-- "quero ver a data que o e-mail chegou"). created_at é quando o CRM importou,
-- que pode ser horas ou dias depois. Coluna nova e nula; os que já estão na fila
-- são preenchidos pelo Gmail na próxima vez que a fila abre.
ALTER TABLE email_imports ADD COLUMN received_at DATETIME NULL;
