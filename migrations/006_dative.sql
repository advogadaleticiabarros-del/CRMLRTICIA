-- ============================================================
-- Migration 006 — Advocacia Dativa (nomeações do Estado)
-- FullCycle Squad — DBA: Lucas
-- Módulo separado do financeiro de honorários de clientes.
-- ============================================================

-- Demandas dativas (nomeações pelo Estado)
CREATE TABLE IF NOT EXISTS dative_cases (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         INT UNSIGNED NOT NULL,
  process_number  VARCHAR(50)  NULL,
  comarca         VARCHAR(150) NOT NULL,
  vara            VARCHAR(150) NULL,
  assisted_name   VARCHAR(255) NULL,
  area            ENUM('criminal','familia','civel','previdenciario','trabalhista','infancia','outro') NOT NULL DEFAULT 'outro',
  nomeacao_date   DATE         NULL,
  estimated_value DECIMAL(12,2) NOT NULL DEFAULT 0,
  status          ENUM('nomeada','em_andamento','concluida','paga') NOT NULL DEFAULT 'nomeada',
  notes           TEXT         NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_dative_cases_user (user_id),
  INDEX idx_dative_cases_status (status),
  INDEX idx_dative_cases_comarca (comarca),
  CONSTRAINT fk_dative_cases_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audiências das demandas dativas
CREATE TABLE IF NOT EXISTS dative_hearings (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dative_case_id INT UNSIGNED NOT NULL,
  user_id        INT UNSIGNED NOT NULL,
  hearing_date   DATETIME     NOT NULL,
  comarca        VARCHAR(150) NULL,
  type           VARCHAR(100) NULL,
  act_value      DECIMAL(12,2) NOT NULL DEFAULT 0,
  status         ENUM('agendada','realizada','adiada','cancelada') NOT NULL DEFAULT 'agendada',
  notes          TEXT         NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_dative_hearings_case (dative_case_id),
  INDEX idx_dative_hearings_user (user_id),
  INDEX idx_dative_hearings_status (status),
  INDEX idx_dative_hearings_date (hearing_date),
  CONSTRAINT fk_dative_hearings_case FOREIGN KEY (dative_case_id) REFERENCES dative_cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_dative_hearings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Recebimentos do Estado (pagamentos, geralmente em lotes)
CREATE TABLE IF NOT EXISTS dative_payments (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id        INT UNSIGNED NOT NULL,
  dative_case_id INT UNSIGNED NULL,
  reference      VARCHAR(255) NULL,
  value          DECIMAL(12,2) NOT NULL DEFAULT 0,
  expected_date  DATE         NULL,
  received_date  DATE         NULL,
  status         ENUM('previsto','recebido') NOT NULL DEFAULT 'previsto',
  notes          TEXT         NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_dative_pay_user (user_id),
  INDEX idx_dative_pay_status (status),
  CONSTRAINT fk_dative_pay_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_dative_pay_case FOREIGN KEY (dative_case_id) REFERENCES dative_cases(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
