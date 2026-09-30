-- ============================================================
-- Migration 141 — Conversa de WhatsApp vinculada a UM processo
-- Diagnóstico ago/2026 (WhatsApp jurídico): cliente com vários processos —
-- a advogada escolhe (opcional) sobre qual processo é a conversa.
-- intimacao_alert_at evita repetir o aviso de "recebi intimação" (12h).
-- ============================================================

ALTER TABLE whatsapp_chat_meta
  ADD COLUMN case_id INT UNSIGNED NULL,
  ADD COLUMN intimacao_alert_at DATETIME NULL
