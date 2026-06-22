-- ============================================================
-- Migration 022 — Vínculos da IA Jurídica (Fase 4)
-- Liga as gerações de IA ao cliente/caso e dá um título.
-- ============================================================

ALTER TABLE ai_generations
  ADD COLUMN client_id INT UNSIGNED NULL,
  ADD COLUMN case_id   INT UNSIGNED NULL,
  ADD COLUMN title     VARCHAR(255) NULL,
  ADD INDEX idx_ai_gen_client (client_id),
  ADD CONSTRAINT fk_ai_gen_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_ai_gen_case   FOREIGN KEY (case_id)   REFERENCES cases(id)   ON DELETE SET NULL;
