-- ============================================================
-- Migration 032 — Liga o caso interno (esteira) ao processo monitorado (OAB/DJEN)
-- ============================================================

ALTER TABLE cases ADD COLUMN origin_process_id INT UNSIGNED NULL;
CREATE INDEX idx_cases_origin_process ON cases (origin_process_id);
