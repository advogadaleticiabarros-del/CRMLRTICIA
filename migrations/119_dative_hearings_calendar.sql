-- ============================================================
-- Migration 119 — Audiência dativa × Agenda (Google Calendar)
--
-- dative_hearings nunca gerava evento nenhum em calendar_events —
-- audiência dativa (o compromisso mais comum da cliente) ficava de
-- fora da cor automática por status implementada na migration 118.
--
-- Segue o mesmo padrão já usado para correspondent_hearings
-- (migration 023_calendar_correspondent.sql): uma FK simples de
-- calendar_events para a audiência de origem, para achar/atualizar
-- sempre o mesmo evento em vez de duplicar a cada edição.
-- ============================================================

ALTER TABLE calendar_events
  ADD COLUMN dative_hearing_id INT UNSIGNED NULL,
  ADD INDEX idx_calendar_dative_hearing (dative_hearing_id),
  ADD CONSTRAINT fk_calendar_dative_hearing FOREIGN KEY (dative_hearing_id) REFERENCES dative_hearings(id) ON DELETE SET NULL;
