-- ============================================================
-- Migration 094 — Responder citando uma mensagem (reply/quote)
-- Guarda uma "foto" do texto citado no momento do envio — assim a citação
-- continua fazendo sentido mesmo se a mensagem original for editada ou
-- apagada depois.
-- ============================================================

ALTER TABLE whatsapp_messages
  ADD COLUMN reply_to_message_id INT UNSIGNED NULL,
  ADD COLUMN reply_to_body        VARCHAR(500) NULL,
  ADD COLUMN reply_to_from_me     TINYINT(1)   NULL;
