-- ============================================================
-- Migration 143 — Registro de quando o cliente abre o link da proposta
-- Pedido 01/10/2026: indicar na conversa do WhatsApp que o lead está
-- analisando a proposta (e se já abriu o link).
-- ============================================================

ALTER TABLE propostas
  ADD COLUMN visualizada_em DATETIME NULL,
  ADD COLUMN ultima_visualizacao_em DATETIME NULL
