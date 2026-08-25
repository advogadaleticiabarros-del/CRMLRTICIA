-- ============================================================
-- Migration 102 — Resolução de itens do Cockpit
-- Guarda quais itens do painel "Cockpit" (prazos/intimações/alertas/
-- agenda) a usuária marcou como resolvidos, sem tocar nas tabelas de
-- origem (deadlines/detected_deadlines/movement_alerts/calendar_events).
-- Expira sozinho: o filtro de leitura só considera resolved_at de HOJE
-- (fuso America/Sao_Paulo) — ver src/routes/dashboards/cockpit.ts.
-- ============================================================

CREATE TABLE IF NOT EXISTS cockpit_resolutions (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_key     VARCHAR(64)  NOT NULL,
  user_id      INT UNSIGNED NOT NULL,
  resolved_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cockpit_resolution (item_key, user_id),
  CONSTRAINT fk_cockpit_resolution_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
