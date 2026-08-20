-- ============================================================
-- Migration 097 — Snapshot do briefing matinal (para o fechamento do dia)
-- Guarda o que saiu no resumo das 07h para o fechamento das 18:30 comparar
-- e mostrar o que foi concluído/ficou pendente/passa pro dia seguinte.
-- ============================================================

CREATE TABLE IF NOT EXISTS briefing_snapshots (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL,
  snapshot_date DATE         NOT NULL,
  payload       JSON         NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_briefing_snapshot (user_id, snapshot_date),
  CONSTRAINT fk_briefing_snapshot_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
