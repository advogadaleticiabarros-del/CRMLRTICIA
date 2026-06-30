-- ============================================================
-- Migration 045 — Parcerias (empresas que indicam clientes, ex.: INFINITY LAW)
-- Casos entram direto na esteira de produção (mesmo SLA), com registro próprio
-- (fora do funil de lead) e termos financeiros do acordo.
-- ============================================================

CREATE TABLE IF NOT EXISTS partners (
  id                         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name                       VARCHAR(255) NOT NULL,
  success_fee_percent        DECIMAL(5,2) NOT NULL DEFAULT 30.00,  -- % do êxito cobrado do cliente
  partner_split_percent      DECIMAL(5,2) NOT NULL DEFAULT 50.00,  -- fatia do parceiro sobre a taxa do escritório (êxito)
  sucumbencia_split_percent  DECIMAL(5,2) NOT NULL DEFAULT 50.00,  -- divisão da sucumbência
  entry_value_single         DECIMAL(12,2) NOT NULL DEFAULT 100.00, -- entrada por protocolo (1 processo)
  entry_value_double         DECIMAL(12,2) NOT NULL DEFAULT 130.00, -- entrada quando 2 processos do mesmo cliente
  entry_split                TINYINT(1)    NOT NULL DEFAULT 0,       -- entrada é dividida com o parceiro? (não)
  notes                      TEXT          NULL,
  active                     TINYINT(1)    NOT NULL DEFAULT 1,
  created_at                 DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                 DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE cases
  ADD COLUMN partner_id INT UNSIGNED NULL,
  ADD INDEX idx_cases_partner (partner_id);

INSERT INTO partners (name, success_fee_percent, partner_split_percent, sucumbencia_split_percent, entry_value_single, entry_value_double, entry_split, notes)
VALUES ('INFINITY LAW', 30.00, 50.00, 50.00, 100.00, 130.00, 0, 'Indica clientes. Êxito 30% sobre o ganho, dividido 50/50. Entrada por protocolo (R$100, ou R$130 para 2 processos do mesmo cliente) 100% do escritório. Sucumbência 50/50.');
