-- ============================================================
-- Migration 090 — Auditoria de exclusão de mensagens do WhatsApp
-- Apagar uma mensagem enviada agora exige motivo obrigatório, registrado
-- aqui (quem apagou, quando, o texto original e o porquê) — pedido
-- explícito pra rastreabilidade em caso de dúvida futura.
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_message_deletions (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id    INT UNSIGNED NOT NULL,
  phone         VARCHAR(30)  NOT NULL,
  body_original TEXT         NULL,
  reason        VARCHAR(500) NOT NULL,
  deleted_by    INT UNSIGNED NULL,
  deleted_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_wa_msg_del_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
