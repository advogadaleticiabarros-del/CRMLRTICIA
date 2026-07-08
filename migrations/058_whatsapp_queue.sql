-- ============================================================
-- Migration 058 — Fila de WhatsApp (envio manual em 1 clique)
-- O sistema gera as mensagens prontas (cobrança, audiência,
-- protocolo); o usuário envia pelo próprio WhatsApp via wa.me.
-- ref_key único evita duplicar a mesma mensagem.
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_queue (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id      INT UNSIGNED NULL,
  recipient_name VARCHAR(255) NOT NULL,
  phone          VARCHAR(30)  NOT NULL,
  message        TEXT         NOT NULL,
  context        VARCHAR(40)  NOT NULL DEFAULT 'avulsa',
  ref_key        VARCHAR(120) NULL,
  status         ENUM('pendente','enviada','descartada') NOT NULL DEFAULT 'pendente',
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at        DATETIME     NULL,
  UNIQUE KEY uq_wa_ref (ref_key),
  INDEX idx_wa_status (status),
  INDEX idx_wa_client (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
