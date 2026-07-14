-- ============================================================
-- Migration 066 — Autoria das respostas de WhatsApp
-- Registra QUEM respondeu cada mensagem enviada pelo CRM
-- (controle de atendimento; envios do robô ficam identificados).
-- ============================================================

ALTER TABLE whatsapp_messages
  ADD COLUMN sent_by VARCHAR(120) NULL
