-- ============================================================
-- Migration 147 — Tarefa "Analisar" ligada ao prazo detectado
-- Análise 02/10/2026: 109 de 114 tarefas vencidas eram "Analisar <tipo> —
-- proc. <nº>" que nunca fechavam ao confirmar/descartar o prazo detectado.
-- ============================================================

ALTER TABLE tasks
  ADD COLUMN detected_deadline_id INT UNSIGNED NULL,
  ADD INDEX idx_tasks_detected_deadline (detected_deadline_id)
