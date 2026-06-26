-- ============================================================
-- Migration 036 — DJEN: schema de intimações e alertas
-- Objetivo: distinguir intimações (DJEN) de movimentos genéricos
-- (DataJud) na tabela process_movements, e criar a salvaguarda
-- de alertas para movimentos sem teor correspondente.
-- ============================================================

-- 1. Novas colunas em process_movements
ALTER TABLE process_movements
  ADD COLUMN movement_type     ENUM('movimento','intimacao','publicacao') NULL AFTER source,
  ADD COLUMN djen_id           BIGINT       NULL AFTER movement_type,
  ADD COLUMN is_deadline_trigger TINYINT(1) NOT NULL DEFAULT 0 AFTER djen_id,
  ADD COLUMN movement_metadata JSON         NULL AFTER is_deadline_trigger,
  ADD INDEX idx_pm_djen (djen_id),
  ADD INDEX idx_pm_trigger (is_deadline_trigger);

-- 2. Tabela de alertas (salvaguarda) — movimentos DataJud com
--    palavra-gatilho que NÃO têm intimação DJEN correspondente.
--    Gera um alerta leve em vez de um falso prazo.
CREATE TABLE IF NOT EXISTS movement_alerts (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  process_id       INT UNSIGNED NOT NULL,
  movement_id      INT UNSIGNED NULL,
  movement_date    DATETIME     NULL,
  title            VARCHAR(500) NULL,
  description      TEXT         NULL,
  alert_type       VARCHAR(60)  NOT NULL DEFAULT 'movimento_sem_intimacao',
  detected_keyword VARCHAR(60)  NULL,
  status           ENUM('aberto','verificado','resolvido','descartado') NOT NULL DEFAULT 'aberto',
  resolution       VARCHAR(500) NULL,
  resolved_by      INT UNSIGNED NULL,
  resolved_at      DATETIME     NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_ma_process  (process_id),
  INDEX idx_ma_status   (status),
  INDEX idx_ma_alert    (alert_type),
  INDEX idx_ma_created  (created_at),

  CONSTRAINT fk_ma_process  FOREIGN KEY (process_id)  REFERENCES legal_processes(id) ON DELETE CASCADE,
  CONSTRAINT fk_ma_movement FOREIGN KEY (movement_id) REFERENCES process_movements(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Notificações: já aceita qualquer string em notification_type, sem restrição ENUM
