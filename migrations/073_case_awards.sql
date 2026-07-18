-- ============================================================
-- Migration 073 — Êxitos a receber de casos PRÓPRIOS:
-- RPV, precatório, alvará judicial e acordos homologados.
-- (Casos de parceria já têm êxito/sucumbência via financial_records+repasses.)
-- ============================================================

CREATE TABLE IF NOT EXISTS case_awards (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id          INT UNSIGNED NULL,
  client_id        INT UNSIGNED NULL,
  kind             ENUM('rpv','precatorio','alvara','acordo','outro') NOT NULL DEFAULT 'rpv',
  descricao        VARCHAR(255) NULL,
  valor_bruto      DECIMAL(14,2) NOT NULL DEFAULT 0,
  valor_escritorio DECIMAL(14,2) NOT NULL DEFAULT 0,
  data_expedicao   DATE NULL,
  previsao_pagamento DATE NULL,
  data_recebimento DATE NULL,
  status           ENUM('aguardando','recebido','cancelado') NOT NULL DEFAULT 'aguardando',
  notes            TEXT NULL,
  created_by       INT UNSIGNED NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_awards_status (status),
  INDEX idx_awards_case (case_id),
  INDEX idx_awards_previsao (previsao_pagamento)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
