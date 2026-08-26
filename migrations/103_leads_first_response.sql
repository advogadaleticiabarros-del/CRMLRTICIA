-- ============================================================
-- Migration 103 — Cronômetro de tempo de primeira resposta do lead
-- Marca quando um lead recebeu a primeira resposta real do escritório
-- (saiu de "triagem" OU alguém clicou em "Chamar no WhatsApp" nele —
-- o que ocorrer primeiro). Mesmo padrão de leads.analise_since
-- (migration 009): campo simples, setado uma vez, nunca resetado.
-- ============================================================

ALTER TABLE leads ADD COLUMN first_response_at DATETIME NULL;
