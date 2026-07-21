-- ============================================================
-- Migration 075 — Acordo: entrada + parcelamento explícitos, honorários
-- sucumbenciais separados dos contratuais, e rastreio do lançamento
-- automático no financeiro (financial_records.agreement_id).
-- ============================================================

ALTER TABLE agreements
  ADD COLUMN entrada_value DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN entrada_date  DATE NULL,
  ADD COLUMN sucumbencia_value    DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN sucumbencia_due_date DATE NULL;

ALTER TABLE financial_records
  ADD COLUMN agreement_id INT UNSIGNED NULL,
  ADD INDEX idx_financial_agreement (agreement_id),
  ADD CONSTRAINT fk_financial_agreement FOREIGN KEY (agreement_id) REFERENCES agreements(id) ON DELETE SET NULL;
