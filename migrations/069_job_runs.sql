-- Migration 069 — Saúde das rotinas automáticas (crons)
-- Antes desta tabela, as ~20 rotinas engoliam erros em silêncio: uma falha no
-- cron de PRAZOS ou no BACKUP podia durar dias sem ninguém perceber.
CREATE TABLE IF NOT EXISTS job_runs (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  job          VARCHAR(80)  NOT NULL,           -- nome da rotina
  status       ENUM('ok','erro') NOT NULL,
  message      TEXT         NULL,               -- resumo (ok) ou mensagem de erro
  duration_ms  INT          NULL,
  ran_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_job_runs_job (job, ran_at),
  INDEX idx_job_runs_status (status, ran_at)
);
