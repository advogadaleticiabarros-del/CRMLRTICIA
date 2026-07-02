-- ============================================================
-- Migration 049 — Integracao Gmail da parceria + anexos
-- Guarda os tokens do Gmail que RECEBE os e-mails do parceiro (conta unica,
-- id=1) e o filtro de remetente. email_imports ganha attachments_json para
-- os anexos (baixados do Gmail e enviados ao Drive na confirmacao).
-- IMPORTANTE: o runner remove linhas iniciadas por '--' e divide por ';'.
-- Nenhum statement abaixo contem ';' interno.
-- ============================================================

CREATE TABLE IF NOT EXISTS email_integration (
  id             INT UNSIGNED PRIMARY KEY,
  google_email   VARCHAR(255) NULL,
  access_token   TEXT         NULL,
  refresh_token  TEXT         NULL,
  token_expiry   DATETIME     NULL,
  sender_filter  VARCHAR(255) NOT NULL DEFAULT 'infinitylaw@outlook.com.br',
  drive_folder_id VARCHAR(120) NULL,
  active         TINYINT(1)   NOT NULL DEFAULT 1,
  last_sync      DATETIME     NULL,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE email_imports
  ADD COLUMN attachments_json LONGTEXT NULL
