-- ============================================================
-- Migration 033 — Fase processual dos processos monitorados
-- ============================================================

ALTER TABLE legal_processes
  ADD COLUMN phase ENUM('inicial','instrucao','sentenca','recurso','execucao','encerrado') NOT NULL DEFAULT 'inicial';
