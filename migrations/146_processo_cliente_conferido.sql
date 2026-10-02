-- ============================================================
-- Migration 146 — Conferência do cliente do processo
-- Análise 02/10/2026: a descoberta por OAB vinculou a parte contrária
-- (empresa ré, INSS) como cliente. Marca o que a advogada já conferiu.
-- ============================================================

ALTER TABLE legal_processes ADD COLUMN cliente_conferido TINYINT(1) NOT NULL DEFAULT 0
