-- ============================================================
-- Migration 024 — Detector de prazos (a partir do monitoramento)
-- Movimentações com palavra-gatilho viram um "prazo a confirmar".
-- O sistema NÃO chuta a data: sugere o tipo/dias e o(a) advogado(a)
-- confirma, gerando a data-limite (dias úteis).
-- ============================================================

CREATE TABLE IF NOT EXISTS detected_deadlines (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  process_id       INT UNSIGNED NULL,
  client_id        INT UNSIGNED NULL,
  movement_text    VARCHAR(500) NULL,
  detected_keyword VARCHAR(60)  NULL,
  suggested_type   VARCHAR(80)  NULL,
  suggested_days   INT          NULL,
  start_date       DATE         NULL,
  due_date         DATE         NULL,
  deadline_type    VARCHAR(120) NULL,
  status           ENUM('a_confirmar','confirmado','descartado') NOT NULL DEFAULT 'a_confirmar',
  confirmed_by     INT UNSIGNED NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_dd_status  (status),
  INDEX idx_dd_process (process_id),
  INDEX idx_dd_due     (due_date),

  CONSTRAINT fk_dd_process FOREIGN KEY (process_id) REFERENCES legal_processes(id) ON DELETE CASCADE,
  CONSTRAINT fk_dd_client  FOREIGN KEY (client_id)  REFERENCES clients(id)         ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
