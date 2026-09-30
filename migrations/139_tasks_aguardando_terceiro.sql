-- ============================================================
-- Migration 139 — Tarefa "aguardando terceiro"
-- Diagnóstico ago/2026 (fechamento do dia): faltava o conceito de tarefa
-- travada esperando resposta de alguém (cliente, perito, cartório).
-- Só acrescenta valor ao ENUM e uma coluna opcional — compatível com dados.
-- ============================================================

ALTER TABLE tasks
  MODIFY COLUMN status ENUM('pendente','em_andamento','concluida','cancelada','aguardando_terceiro') NOT NULL DEFAULT 'pendente',
  ADD COLUMN waiting_on VARCHAR(160) NULL
