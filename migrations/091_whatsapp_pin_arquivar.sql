-- ============================================================
-- Migration 091 — Fixar e arquivar conversa (paridade com WhatsApp Web)
-- ============================================================

ALTER TABLE whatsapp_chat_meta
  ADD COLUMN pinned    TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN archived  TINYINT(1) NOT NULL DEFAULT 0;
