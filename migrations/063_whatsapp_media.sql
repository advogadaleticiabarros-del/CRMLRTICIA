-- ============================================================
-- Migration 063 — Mídia recebida pelo WhatsApp
-- Fotos/PDFs/áudios enviados pelo cliente ficam no banco e
-- viram Documentos do cliente automaticamente.
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_media (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  phone      VARCHAR(30)  NOT NULL,
  client_id  INT UNSIGNED NULL,
  file_name  VARCHAR(255) NOT NULL,
  mime       VARCHAR(120) NOT NULL,
  data       LONGBLOB     NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_wmedia_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE whatsapp_messages
  ADD COLUMN media_id INT UNSIGNED NULL
