-- ============================================================
-- Migration 025 — Assinatura eletrônica também para contratos
-- Permite que a solicitação de assinatura aponte para um contrato
-- (além de documento do GED). document_id passa a ser opcional.
-- ============================================================

ALTER TABLE signature_requests
  MODIFY COLUMN document_id INT UNSIGNED NULL,
  ADD COLUMN contract_id INT UNSIGNED NULL,
  ADD INDEX idx_sig_contract (contract_id),
  ADD CONSTRAINT fk_sig_contract FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE;
