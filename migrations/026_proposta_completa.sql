-- ============================================================
-- Migration 026 — Produção da Proposta (completa)
-- Dados do cliente, tipo de causa, descrição, dependentes e a
-- composição de honorários (modalidades + combinações) em JSON.
-- client_id passa a ser opcional (proposta pode nascer só do lead).
-- ============================================================

ALTER TABLE propostas
  MODIFY COLUMN client_id INT UNSIGNED NULL,
  ADD COLUMN legal_area   VARCHAR(60)  NULL,
  ADD COLUMN tipo_causa    VARCHAR(255) NULL,
  ADD COLUMN contact_name  VARCHAR(255) NULL,
  ADD COLUMN cpf           VARCHAR(20)  NULL,
  ADD COLUMN phone         VARCHAR(30)  NULL,
  ADD COLUMN email         VARCHAR(255) NULL,
  ADD COLUMN dependentes   JSON         NULL,
  ADD COLUMN honorarios    JSON         NULL,
  ADD COLUMN observacoes   LONGTEXT     NULL;
