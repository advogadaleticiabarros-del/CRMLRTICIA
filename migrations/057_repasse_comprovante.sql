-- ============================================================
-- Migration 057 — Comprovante do repasse
-- Link (Drive ou outro) do comprovante anexado ao marcar o
-- repasse como repassado; o parceiro vê/baixa no portal.
-- ============================================================

ALTER TABLE repasses
  ADD COLUMN comprovante_url VARCHAR(1000) NULL
