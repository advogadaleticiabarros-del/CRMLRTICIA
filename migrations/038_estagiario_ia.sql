-- ============================================================
-- Migration 038 — Estagiário IA no prazo detectado
-- Quando uma intimação DJEN vira "prazo a confirmar", o estagiário gera
-- automaticamente uma análise (resumo + prazo + próxima ação + risco) e uma
-- minuta da peça. A análise fica no próprio prazo; a minuta vira um documento
-- de IA referenciado por ai_draft_id.
-- ============================================================

ALTER TABLE detected_deadlines
  ADD COLUMN ai_summary  TEXT         NULL AFTER movement_text,
  ADD COLUMN ai_draft_id INT UNSIGNED NULL AFTER ai_summary;
