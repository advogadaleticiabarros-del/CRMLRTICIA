-- ============================================================
-- Migration 085 — Resumo de IA para contatos novos no WhatsApp
-- Quando a 1ª mensagem de um número desconhecido parece um caso
-- real (não contato pessoal/engano), a IA já deixa nome/área/
-- resumo prontos aqui, pra ela decidir rápido se converte em lead.
-- ============================================================

ALTER TABLE whatsapp_chat_meta
  ADD COLUMN lead_summary TEXT NULL,
  ADD COLUMN lead_area VARCHAR(30) NULL,
  ADD COLUMN lead_nome VARCHAR(255) NULL
