-- ============================================================
-- Migration 051 — Pasta do Drive indicada por caso
-- Permite apontar uma pasta do Google Drive (que a advogada monta manualmente)
-- com os documentos daquele caso, para a IA ler e usar na peticao inicial.
-- ============================================================

ALTER TABLE cases
  ADD COLUMN drive_folder_url VARCHAR(500) NULL
