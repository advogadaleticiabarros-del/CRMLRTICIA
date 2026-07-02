-- ============================================================
-- Migration 050 — Retry robusto da sincronizacao de calendario
-- Antes, um evento que falhava virava sync_status='erro' e NUNCA mais era
-- reprocessado. Agora rastreamos tentativas e a ultima falha, e o push
-- reprocessa pendentes E com erro (ate um limite), sem travar.
-- IMPORTANTE: o runner remove linhas '--' e divide por ';'.
-- ============================================================

ALTER TABLE calendar_events
  ADD COLUMN sync_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN sync_error    VARCHAR(500) NULL
