-- ============================================================
-- Migration 086 — Confirmação de leitura (✓✓) no WhatsApp
-- Guarda o status bruto que a Uazapi manda (sent/delivered/read)
-- pra cada mensagem ENVIADA pelo CRM, atualizado via webhook
-- conforme o contato recebe/lê. Mensagens recebidas não usam
-- este campo (fica NULL).
-- ============================================================

ALTER TABLE whatsapp_messages ADD COLUMN status VARCHAR(20) NULL
