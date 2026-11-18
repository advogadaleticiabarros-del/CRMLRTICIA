-- ============================================================
-- Migration 185 — Quando o processo foi consultado no DataJud para a
-- classificacao (18/11/2026). A rotina consulta poucos por vez (o DataJud
-- limita) e prioriza os nunca consultados e os mais antigos.
-- So acrescenta coluna.
-- ============================================================

ALTER TABLE legal_processes
  ADD COLUMN datajud_classificado_em DATETIME NULL;
