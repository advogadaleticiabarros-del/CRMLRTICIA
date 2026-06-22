-- ============================================================
-- Migration 023 — Agenda × Correspondente
-- Liga o evento da agenda à audiência de correspondente, para
-- sincronizar com o Google Calendar (alerta no celular).
-- ============================================================

ALTER TABLE calendar_events
  ADD COLUMN correspondent_id INT UNSIGNED NULL,
  ADD INDEX idx_calendar_corr (correspondent_id),
  ADD CONSTRAINT fk_calendar_corr FOREIGN KEY (correspondent_id) REFERENCES correspondent_hearings(id) ON DELETE SET NULL;
