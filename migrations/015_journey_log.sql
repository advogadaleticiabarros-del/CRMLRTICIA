-- ============================================================
-- Migration 015 — Jornada unificada (lead → cliente → processo)
-- Registra automaticamente cada evento desde a entrada do lead
-- até a finalização do processo. Complementa client_timeline
-- (que cobre a fase cliente/caso) cobrindo a fase de LEAD.
-- ============================================================

CREATE TABLE IF NOT EXISTS journey_log (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lead_id     INT UNSIGNED NULL,
  client_id   INT UNSIGNED NULL,
  case_id     INT UNSIGNED NULL,
  actor_id    INT UNSIGNED NULL,
  actor_name  VARCHAR(255) NULL,
  event_type  VARCHAR(60)  NOT NULL,
  title       VARCHAR(255) NOT NULL,
  description TEXT         NULL,
  old_value   VARCHAR(255) NULL,
  new_value   VARCHAR(255) NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_journey_lead    (lead_id),
  INDEX idx_journey_client  (client_id),
  INDEX idx_journey_case    (case_id),
  INDEX idx_journey_created (created_at),

  CONSTRAINT fk_journey_lead   FOREIGN KEY (lead_id)   REFERENCES leads(id)   ON DELETE SET NULL,
  CONSTRAINT fk_journey_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  CONSTRAINT fk_journey_case   FOREIGN KEY (case_id)   REFERENCES cases(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
