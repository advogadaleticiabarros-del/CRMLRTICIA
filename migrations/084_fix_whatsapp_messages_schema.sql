-- ============================================================
-- Migration 084 — Corrige colisão de nome em whatsapp_messages
-- A migration 012 (inbox antigo, importado do server-legal-hub,
-- com conversation_id/direction/content) criou whatsapp_messages
-- primeiro. A migration 061 (schema novo, com phone/client_id/
-- from_me/body/msg_time, usado pela instância própria e depois
-- pela Uazapi) usou "CREATE TABLE IF NOT EXISTS" e por isso NUNCA
-- rodou de verdade em produção — a tabela antiga ficou no lugar.
-- As migrations 063/066 só adicionaram media_id/sent_by em cima
-- da tabela ERRADA. Resultado: todo envio/recebimento de WhatsApp
-- desde a migração pra Uazapi tentava gravar em colunas que não
-- existiam (phone, from_me, body, msg_time) e falhava silenciosamente
-- (a maioria das chamadas engolia o erro com .catch), até a rotina
-- "conversas-paradas" (sem .catch) expor o erro no sino.
-- O inbox antigo (whatsapp_conversations e companhia) não é lido
-- por nenhum código vivo — confirmado por busca no repositório.
-- ============================================================

RENAME TABLE whatsapp_messages TO whatsapp_messages_legacy_inbox;

ALTER TABLE whatsapp_messages_legacy_inbox
  RENAME INDEX idx_wa_msg_conversation TO idx_wmli_conversation;

CREATE TABLE whatsapp_messages (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id VARCHAR(120) NULL,
  phone      VARCHAR(30)  NOT NULL,
  client_id  INT UNSIGNED NULL,
  from_me    TINYINT(1)   NOT NULL DEFAULT 0,
  body       TEXT         NOT NULL,
  msg_time   DATETIME     NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  media_id   INT UNSIGNED NULL,
  sent_by    VARCHAR(120) NULL,
  UNIQUE KEY uq_wm_mid (message_id),
  INDEX idx_wm_phone (phone),
  INDEX idx_wm_time (msg_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
