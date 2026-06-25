-- ============================================================
-- Migration 034 — Fase processual SUGERIDA (a partir das movimentações)
-- ============================================================

ALTER TABLE legal_processes
  ADD COLUMN suggested_phase ENUM('inicial','instrucao','sentenca','recurso','execucao','encerrado') NULL;
