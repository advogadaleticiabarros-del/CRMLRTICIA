-- ============================================================
-- Migration 044 — Módulo de Produção (Kanban, SLA, etiquetas, pendências)
-- SLA total: conta os dias desde production_started_at até concluir/protocolar.
-- ============================================================

ALTER TABLE cases
  ADD COLUMN production_started_at DATETIME     NULL,
  ADD COLUMN production_labels     JSON         NULL,
  ADD COLUMN production_assignee   INT UNSIGNED NULL;

UPDATE cases SET production_started_at = created_at
 WHERE production_stage IS NOT NULL AND production_started_at IS NULL;

-- Observações, atualizações e pendências da produção (acompanhamento).
CREATE TABLE IF NOT EXISTS production_notes (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id     INT UNSIGNED NOT NULL,
  user_id     INT UNSIGNED NULL,
  author_name VARCHAR(160) NULL,
  kind        ENUM('observacao','pendencia','atualizacao') NOT NULL DEFAULT 'observacao',
  text        TEXT         NOT NULL,
  resolved    TINYINT(1)   NOT NULL DEFAULT 0,
  resolved_at DATETIME     NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pn_case (case_id),
  INDEX idx_pn_kind (kind),
  CONSTRAINT fk_pn_case FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
