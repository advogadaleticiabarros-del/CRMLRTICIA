-- ============================================================
-- Migration 082 — Dativo: mover para a esteira de producao + relatos
-- (atualizacoes registradas na demanda, tipo uma linha do tempo)
-- ============================================================

ALTER TABLE dative_cases
  ADD COLUMN case_id INT UNSIGNED NULL,
  ADD INDEX idx_dative_cases_case (case_id),
  ADD CONSTRAINT fk_dative_cases_esteira FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS dative_case_notes (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dative_case_id INT UNSIGNED NOT NULL,
  user_id        INT UNSIGNED NOT NULL,
  text           TEXT         NOT NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_dcn_case (dative_case_id),
  CONSTRAINT fk_dcn_case FOREIGN KEY (dative_case_id) REFERENCES dative_cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_dcn_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
