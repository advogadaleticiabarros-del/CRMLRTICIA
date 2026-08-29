-- ============================================================
-- Migration 117 — Bloqueio e silenciamento de conversa (paridade
-- com o estado real do WhatsApp, refletido na Uazapi)
-- ============================================================

ALTER TABLE whatsapp_chat_meta
  ADD COLUMN blocked      TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN muted_until  BIGINT     NULL DEFAULT NULL;
