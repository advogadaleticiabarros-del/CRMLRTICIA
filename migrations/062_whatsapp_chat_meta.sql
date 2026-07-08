-- ============================================================
-- Migration 062 — Metadados das conversas de WhatsApp
-- Etiquetas coloridas por conversa + contador de não lidas
-- (experiência estilo WhatsApp Web dentro do CRM).
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_chat_meta (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  phone      VARCHAR(30) NOT NULL,
  labels     TEXT        NULL,
  unread     INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wcm_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
