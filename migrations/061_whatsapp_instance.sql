-- ============================================================
-- Migration 061 — Instância de WhatsApp (Baileys) + conversas
-- whatsapp_sessions: credenciais da sessão (sobrevive a deploys)
-- whatsapp_messages: conversas (recebidas e enviadas) no CRM
-- whatsapp_queue.sent_via: como a mensagem saiu (wa.me/instância)
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_key VARCHAR(120) NOT NULL,
  data        LONGTEXT     NOT NULL,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ws_key (session_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id VARCHAR(120) NULL,
  phone      VARCHAR(30)  NOT NULL,
  client_id  INT UNSIGNED NULL,
  from_me    TINYINT(1)   NOT NULL DEFAULT 0,
  body       TEXT         NOT NULL,
  msg_time   DATETIME     NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wm_mid (message_id),
  INDEX idx_wm_phone (phone),
  INDEX idx_wm_time (msg_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE whatsapp_queue
  ADD COLUMN sent_via VARCHAR(20) NULL
