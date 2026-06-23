-- ============================================================
-- Migration 027 — Link público da proposta
-- Token para o cliente abrir a proposta pelo navegador/WhatsApp,
-- e marca de aceite pelo cliente.
-- ============================================================

ALTER TABLE propostas
  ADD COLUMN public_token CHAR(36) NULL,
  ADD COLUMN aceito_em    DATETIME NULL;

CREATE UNIQUE INDEX idx_propostas_token ON propostas (public_token);
