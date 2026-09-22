-- ============================================================
-- Migration 133 — Triagem de conversas do WhatsApp por IA
-- Pedido da Dra. Leticia: reconhecer parceiro/correspondente automaticamente
-- pelo telefone (sem IA — comparacao direta, mais confiavel) e separar, na
-- primeira mensagem de um numero desconhecido, "so cumprimento" de um
-- relato de caso real (a IA ja fazia essa segunda parte parcialmente).
-- ============================================================

ALTER TABLE partners
  ADD COLUMN phone VARCHAR(20) NULL;

ALTER TABLE whatsapp_chat_meta
  ADD COLUMN greeting_only TINYINT(1) NOT NULL DEFAULT 0;
