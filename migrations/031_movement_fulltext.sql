-- ============================================================
-- Migration 031 — Movimentações na íntegra (texto longo)
-- ============================================================

ALTER TABLE process_movements MODIFY COLUMN description MEDIUMTEXT NULL;
