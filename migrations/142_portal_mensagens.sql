-- ============================================================
-- Migration 142 — Mensagens do portal do cliente
-- Diagnóstico ago/2026 (portal como hub): canal registrado cliente <->
-- escritório dentro do portal, sem depender só do WhatsApp.
-- from_client = 1 quando quem escreveu foi o cliente.
-- read_at marca a leitura pelo outro lado.
-- ============================================================

CREATE TABLE IF NOT EXISTS portal_messages (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id   INT UNSIGNED NOT NULL,
  case_id     INT UNSIGNED NULL,
  from_client TINYINT(1)   NOT NULL,
  author_id   INT UNSIGNED NULL,
  body        TEXT         NOT NULL,
  read_at     DATETIME     NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pm_client (client_id, created_at),
  CONSTRAINT fk_pm_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
