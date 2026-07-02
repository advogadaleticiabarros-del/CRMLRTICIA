-- ============================================================
-- Migration 048 — Fila de importacao por e-mail (parceria Infinity)
-- A IA le o e-mail do parceiro, extrai cliente + casos (pode haver 2+ casos
-- de um mesmo cliente) e grava aqui como PENDENTE para revisao humana antes
-- de criar cliente/casos/entrada. Idempotente por source_message_id.
-- IMPORTANTE: o runner divide por ';' e remove linhas iniciadas por '--',
-- entao nenhum conteudo abaixo contem ';' nem linha comecando por '--'.
-- ============================================================

CREATE TABLE IF NOT EXISTS email_imports (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source            VARCHAR(40)  NOT NULL DEFAULT 'manual',
  source_message_id VARCHAR(255) NULL,
  from_email        VARCHAR(255) NULL,
  subject           VARCHAR(500) NULL,
  raw_text          LONGTEXT     NULL,
  parsed_json       LONGTEXT     NULL,
  partner_id        INT UNSIGNED NULL,
  status            VARCHAR(20)  NOT NULL DEFAULT 'pendente',
  client_id         INT UNSIGNED NULL,
  note              VARCHAR(500) NULL,
  created_by        INT UNSIGNED NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at      DATETIME     NULL,
  UNIQUE KEY uq_msg (source_message_id),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
