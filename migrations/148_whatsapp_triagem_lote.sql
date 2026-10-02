-- ============================================================
-- Migration 148 — Triagem em lote dos números sem cadastro
-- Análise 02/10/2026: 66 números de WhatsApp em 30 dias sem lead/cliente.
-- Guarda a sugestão da IA (categoria/nome/motivo) para a advogada confirmar.
-- ============================================================

ALTER TABLE whatsapp_chat_meta
  ADD COLUMN triagem_categoria VARCHAR(20) NULL,
  ADD COLUMN triagem_nome VARCHAR(120) NULL,
  ADD COLUMN triagem_motivo VARCHAR(160) NULL
