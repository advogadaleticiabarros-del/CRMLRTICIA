-- ============================================================
-- Migration 052 — Conta a pagar: pagadora, banco e escopo (empresa/pessoal)
-- Permite registrar QUEM paga e de QUAL banco sai, e separar despesa da
-- EMPRESA das PESSOAIS (com contraste visual na tela).
-- ============================================================

ALTER TABLE financial_records
  ADD COLUMN pagador VARCHAR(120) NULL,
  ADD COLUMN banco   VARCHAR(120) NULL,
  ADD COLUMN escopo  VARCHAR(12)  NOT NULL DEFAULT 'empresa';

ALTER TABLE cashflow_entries
  ADD COLUMN pagador VARCHAR(120) NULL,
  ADD COLUMN banco   VARCHAR(120) NULL,
  ADD COLUMN escopo  VARCHAR(12)  NOT NULL DEFAULT 'empresa'
