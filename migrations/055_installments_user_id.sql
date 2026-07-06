-- Migration 055 — Adiciona user_id em installments
-- Necessário para os dashboards financeiro e cockpit filtrarem por advogado.
-- O campo era inexistente; backfill via cases (via case_id ou proposta → case).

ALTER TABLE installments
  ADD COLUMN user_id INT UNSIGNED NULL AFTER client_id;

UPDATE installments i
  JOIN cases c ON c.id = i.case_id
  SET i.user_id = c.user_id
  WHERE i.user_id IS NULL AND i.case_id IS NOT NULL;

UPDATE installments i
  JOIN propostas p ON p.id = i.proposta_id
  JOIN cases c     ON c.id = p.case_id
  SET i.user_id = c.user_id
  WHERE i.user_id IS NULL AND i.proposta_id IS NOT NULL AND p.case_id IS NOT NULL;

ALTER TABLE installments
  ADD INDEX idx_installments_user (user_id);
