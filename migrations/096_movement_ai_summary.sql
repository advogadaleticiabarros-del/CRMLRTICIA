-- ============================================================
-- Migration 096 — Interpretação por IA de movimentações processuais
-- Guarda o resultado da análise (resumo/ação/prazo interno/prioridade)
-- gerada pelo Estagiário IA (Groq) para o briefing matinal. JSON, não
-- colunas separadas — o formato pode evoluir sem migration nova.
-- ============================================================

ALTER TABLE process_movements ADD COLUMN ai_summary JSON NULL;
