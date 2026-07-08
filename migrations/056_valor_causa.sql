-- ============================================================
-- Migration 056 — Valor da causa no caso
-- Informado ao protocolar (junto com o nº do processo), não é
-- definitivo: serve para saber os valores protocolados.
-- Visível também ao parceiro no portal.
-- ============================================================

ALTER TABLE cases
  ADD COLUMN valor_causa DECIMAL(12,2) NULL
