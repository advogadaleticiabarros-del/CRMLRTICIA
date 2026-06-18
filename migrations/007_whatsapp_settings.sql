-- ============================================================
-- Migration 007 — Configuração WhatsApp (preparado para o futuro)
-- FullCycle Squad — DBA: Lucas
-- Estrutura pronta para integrar a WhatsApp Cloud API (Meta) quando desejado.
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_settings (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id          INT UNSIGNED NOT NULL,
  provider         VARCHAR(50)  NOT NULL DEFAULT 'meta',
  access_token     VARCHAR(500) NULL,
  phone_number_id  VARCHAR(100) NULL,
  recipient_phone  VARCHAR(30)  NULL,
  enabled          TINYINT(1)   NOT NULL DEFAULT 0,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_whatsapp_user (user_id),
  CONSTRAINT fk_whatsapp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
