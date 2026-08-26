-- ============================================================
-- Migration 104 — Qualificação automática do lead pela IA
-- Sugestões da IA sobre um lead novo: urgência comercial e faixa de
-- valor estimado. Campos PRÓPRIOS (prefixo ai_) — nunca escrevem em
-- cima de legal_area/estimated_value definidos por humano. Ver
-- docs/superpowers/specs/2026-08-25-qualificacao-ia-lead.md
-- ============================================================

ALTER TABLE leads ADD COLUMN ai_urgency VARCHAR(10) NULL;
ALTER TABLE leads ADD COLUMN ai_value_range VARCHAR(10) NULL;
