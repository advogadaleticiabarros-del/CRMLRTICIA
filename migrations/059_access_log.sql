-- ============================================================
-- Migration 059 — Log de acesso a dados pessoais (LGPD)
-- Registra QUEM abriu a ficha de QUAL cliente e quando.
-- Consulta: Configurações (admin) ou SQL direto.
-- ============================================================

CREATE TABLE IF NOT EXISTS access_logs (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  user_name  VARCHAR(255) NULL,
  client_id  INT UNSIGNED NULL,
  case_id    INT UNSIGNED NULL,
  action     VARCHAR(60)  NOT NULL,
  ip         VARCHAR(60)  NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_al_client (client_id),
  INDEX idx_al_user (user_id),
  INDEX idx_al_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
