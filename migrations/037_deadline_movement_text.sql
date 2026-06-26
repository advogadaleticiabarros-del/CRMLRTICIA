-- ============================================================
-- Migration 037 — Texto da intimação/origem no prazo confirmado
-- Permite ver o teor completo da movimentação diretamente na
-- listagem de prazos, sem precisar abrir o processo externo.
-- ============================================================

ALTER TABLE deadlines
  ADD COLUMN movement_text MEDIUMTEXT NULL AFTER description,
  ADD COLUMN movement_id   INT UNSIGNED NULL AFTER movement_text,
  ADD INDEX idx_dl_movement (movement_id),
  ADD CONSTRAINT fk_dl_movement FOREIGN KEY (movement_id) REFERENCES process_movements(id) ON DELETE SET NULL;
