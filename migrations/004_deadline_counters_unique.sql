-- ============================================================
-- Migration 004 — Chaves únicas em task_deadline_counters
-- FullCycle Squad — DBA: Lucas
-- Corrige o bug sinalizado no item 2: o ON DUPLICATE KEY UPDATE do
-- DeadlineCounterService precisa de chave única em task_id e deadline_id.
-- MySQL permite múltiplos NULL em índice único, então cada task/deadline
-- aparece no máximo uma vez, sem conflitar com as linhas do outro tipo.
-- ============================================================

ALTER TABLE task_deadline_counters
  DROP INDEX idx_tdc_task,
  DROP INDEX idx_tdc_deadline,
  ADD UNIQUE KEY uq_tdc_task (task_id),
  ADD UNIQUE KEY uq_tdc_deadline (deadline_id);
