-- ============================================================
-- Migration 042 — Web Push (notificações com o app fechado)
-- Guarda as inscrições de push de cada dispositivo/usuário (endpoint + chaves).
-- O envio usa VAPID (chaves em VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY no ambiente).
-- ============================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  endpoint   VARCHAR(500) NOT NULL,
  p256dh     VARCHAR(255) NOT NULL,
  auth       VARCHAR(255) NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_push_endpoint (endpoint),
  INDEX idx_push_user (user_id),
  CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
