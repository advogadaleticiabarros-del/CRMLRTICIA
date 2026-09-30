-- ============================================================
-- Migration 138 — Agenda pessoal, recado e medicamento
-- Decisão da Dra. Letícia (diagnóstico ago/2026): trabalho e vida pessoal no
-- mesmo sistema. Três tipos novos de compromisso + repetição diária (remédio
-- todo dia no mesmo horário) + marca de aviso por WhatsApp já enviado.
-- series_id aponta pra ocorrência original da série (NULL na original).
-- Nada é removido do ENUM — só acrescentado, compatível com dados atuais.
-- ============================================================

ALTER TABLE calendar_events
  MODIFY COLUMN event_type ENUM('reuniao','audiencia','prazo','tarefa','compromisso','pessoal','recado','medicamento') NOT NULL DEFAULT 'compromisso',
  ADD COLUMN repeat_daily TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN repeat_until DATE NULL,
  ADD COLUMN series_id INT UNSIGNED NULL,
  ADD COLUMN whatsapp_reminded_at DATETIME NULL,
  ADD INDEX idx_calendar_events_series (series_id)
