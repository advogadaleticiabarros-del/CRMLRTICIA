-- ============================================================
-- Migration 035 — Vincula o prazo detectado à movimentação original
-- Objetivo: permitir ler a intimação/movimentação na ÍNTEGRA antes de
-- confirmar o prazo. O texto completo vive em process_movements.description;
-- o snapshot em detected_deadlines.movement_text era limitado a 500 chars.
-- ============================================================

ALTER TABLE detected_deadlines
  ADD COLUMN movement_id INT UNSIGNED NULL AFTER process_id;

ALTER TABLE detected_deadlines
  MODIFY COLUMN movement_text TEXT NULL;

ALTER TABLE detected_deadlines
  ADD CONSTRAINT fk_dd_movement FOREIGN KEY (movement_id) REFERENCES process_movements(id) ON DELETE SET NULL;

UPDATE detected_deadlines d
  JOIN process_movements pm
    ON pm.process_id = d.process_id
   AND LEFT(pm.description, 180) = LEFT(d.movement_text, 180)
   SET d.movement_id = pm.id
 WHERE d.movement_id IS NULL;
