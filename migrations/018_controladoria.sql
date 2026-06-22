-- ============================================================
-- Migration 018 — Controladoria Jurídica (Fase 2)
-- Provisionamento de processos (ganho/perda × provável/possível/remoto).
-- Rentabilidade e centro de custo são calculados por consulta sobre as
-- fontes já existentes (financial_records, parcelas, installments,
-- cashflow_entries, repasses, agreements).
-- ============================================================

CREATE TABLE IF NOT EXISTS case_provisions (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id     INT UNSIGNED NULL,
  client_id   INT UNSIGNED NULL,
  type        ENUM('ganho','perda') NOT NULL,
  likelihood  ENUM('provavel','possivel','remoto') NOT NULL,
  value       DECIMAL(14,2) NOT NULL DEFAULT 0,
  description VARCHAR(500)  NULL,
  created_by  INT UNSIGNED  NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_prov_case   (case_id),
  INDEX idx_prov_client (client_id),
  INDEX idx_prov_type   (type, likelihood),

  CONSTRAINT fk_prov_case   FOREIGN KEY (case_id)   REFERENCES cases(id)   ON DELETE CASCADE,
  CONSTRAINT fk_prov_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
