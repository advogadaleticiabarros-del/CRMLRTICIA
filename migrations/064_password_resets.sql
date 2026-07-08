-- ============================================================
-- Migration 064 — Redefinição de senha self-service
-- Token de uso único enviado por e-mail (validade 30 min).
-- Guardamos apenas o hash do token (nunca o token em si).
-- ============================================================

CREATE TABLE IF NOT EXISTS password_resets (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  token_hash CHAR(64)     NOT NULL,
  expires_at DATETIME     NOT NULL,
  used_at    DATETIME     NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pr_token (token_hash),
  INDEX idx_pr_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
