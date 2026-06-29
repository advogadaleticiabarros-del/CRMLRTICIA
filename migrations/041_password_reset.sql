-- ============================================================
-- Migration 041 — Recuperação de senha (sem e-mail: via admin)
-- O usuário pede "esqueci minha senha" e os administradores são avisados
-- para gerar uma nova senha. Esta tabela registra os pedidos abertos.
-- ============================================================

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NULL,
  email       VARCHAR(255) NOT NULL,
  status      ENUM('aberto','resolvido') NOT NULL DEFAULT 'aberto',
  resolved_by INT UNSIGNED NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME     NULL,
  INDEX idx_prr_status (status),
  INDEX idx_prr_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
