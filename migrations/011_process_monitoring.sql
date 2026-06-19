-- ============================================================
-- Migration 011 — Monitoramento Processual por OAB (DataJud/CNJ)
-- FullCycle Squad — DBA: Lucas
-- ============================================================

-- Advogados / OAB
CREATE TABLE IF NOT EXISTS lawyers (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name               VARCHAR(255) NOT NULL,
  oab_number         VARCHAR(20)  NULL,
  oab_uf             VARCHAR(2)   NULL,
  email              VARCHAR(255) NULL,
  phone              VARCHAR(30)  NULL,
  telegram_chat_id   VARCHAR(100) NULL,
  google_email       VARCHAR(255) NULL,
  practice_areas     JSON         NULL,
  monitoring_enabled TINYINT(1)   NOT NULL DEFAULT 1,
  active             TINYINT(1)   NOT NULL DEFAULT 1,
  last_sync_at       DATETIME     NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_lawyers_oab (oab_number, oab_uf)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Processos monitorados (camada de acompanhamento — distinta dos cases internos)
CREATE TABLE IF NOT EXISTS legal_processes (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id          INT UNSIGNED NULL,
  lawyer_id          INT UNSIGNED NULL,
  case_id            INT UNSIGNED NULL,
  process_number     VARCHAR(40)  NOT NULL,
  court              VARCHAR(120) NULL,
  court_alias        VARCHAR(60)  NULL,
  judicial_area      VARCHAR(60)  NULL,
  status             ENUM('ativo','arquivado','suspenso','baixado') NOT NULL DEFAULT 'ativo',
  source             VARCHAR(40)  NOT NULL DEFAULT 'manual',
  confidential       TINYINT(1)   NOT NULL DEFAULT 0,
  distribution_date  DATE         NULL,
  last_movement_at   DATETIME     NULL,
  last_sync_at       DATETIME     NULL,
  monitoring_enabled TINYINT(1)   NOT NULL DEFAULT 1,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_lp_client (client_id),
  INDEX idx_lp_lawyer (lawyer_id),
  INDEX idx_lp_number (process_number),
  INDEX idx_lp_monitor (monitoring_enabled),
  CONSTRAINT fk_lp_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  CONSTRAINT fk_lp_lawyer FOREIGN KEY (lawyer_id) REFERENCES lawyers(id) ON DELETE SET NULL,
  CONSTRAINT fk_lp_case   FOREIGN KEY (case_id)   REFERENCES cases(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Movimentações (deduplicadas por unique_hash)
CREATE TABLE IF NOT EXISTS process_movements (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  process_id    INT UNSIGNED NOT NULL,
  movement_date DATETIME     NULL,
  title         VARCHAR(500) NULL,
  description   TEXT         NULL,
  source        VARCHAR(40)  NOT NULL DEFAULT 'datajud',
  unique_hash   CHAR(64)     NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_movement_hash (unique_hash),
  INDEX idx_pm_process (process_id),
  CONSTRAINT fk_pm_process FOREIGN KEY (process_id) REFERENCES legal_processes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Logs de monitoramento
CREATE TABLE IF NOT EXISTS monitoring_logs (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  process_id  INT UNSIGNED NULL,
  lawyer_id   INT UNSIGNED NULL,
  status      ENUM('ok','sem_novidade','nova_movimentacao','nao_encontrado','erro') NOT NULL,
  message     VARCHAR(500) NULL,
  source      VARCHAR(40)  NULL,
  executed_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ml_process (process_id),
  INDEX idx_ml_executed (executed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Advogada principal (OAB editável)
INSERT INTO lawyers (name, oab_number, oab_uf, practice_areas, monitoring_enabled, active)
VALUES ('Letícia Elias Barros', '39948', 'ES', JSON_ARRAY('familia','civel','trabalhista','previdenciario'), 1, 1);
