-- Card único do cliente na produção (30/10/2026, pedido da Jessica): os documentos
-- do cliente ganham nome padrão ("Procuração - Cliente.pdf"). O nome com que o
-- arquivo chegou fica guardado aqui, para conferência e para desfazer. Coluna nova e nula.
ALTER TABLE documents
  ADD COLUMN nome_original VARCHAR(255) NULL;
