-- ============================================================
-- Migration 002 — Dashboards, Calendar, Notifications, Alerts
-- FullCycle Squad — DBA: Lucas
-- ============================================================

-- ─────────────────────────────────────────
-- 1. google_accounts
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_accounts (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         INT UNSIGNED        NOT NULL,
  google_email    VARCHAR(255)        NOT NULL,
  access_token    TEXT                NOT NULL,
  refresh_token   TEXT                NOT NULL,
  token_expiry    DATETIME            NOT NULL,
  sync_enabled    TINYINT(1)          NOT NULL DEFAULT 1,
  created_at      DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_google_accounts_user (user_id),
  INDEX idx_google_accounts_email (google_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- 2. calendar_events
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendar_events (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id       INT UNSIGNED        NULL,
  case_id         INT UNSIGNED        NULL,
  task_id         INT UNSIGNED        NULL,
  deadline_id     INT UNSIGNED        NULL,
  user_id         INT UNSIGNED        NOT NULL,
  google_event_id VARCHAR(255)        NULL,
  title           VARCHAR(500)        NOT NULL,
  description     TEXT                NULL,
  event_type      ENUM('reuniao','audiencia','prazo','tarefa','compromisso') NOT NULL DEFAULT 'compromisso',
  start_datetime  DATETIME            NOT NULL,
  end_datetime    DATETIME            NOT NULL,
  location        VARCHAR(500)        NULL,
  video_link      VARCHAR(1000)       NULL,
  source          ENUM('crm','google') NOT NULL DEFAULT 'crm',
  sync_status     ENUM('pendente','sincronizado','erro') NOT NULL DEFAULT 'pendente',
  created_at      DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_calendar_events_user     (user_id),
  INDEX idx_calendar_events_client   (client_id),
  INDEX idx_calendar_events_case     (case_id),
  INDEX idx_calendar_events_google   (google_event_id),
  INDEX idx_calendar_events_start    (start_datetime),
  INDEX idx_calendar_events_type     (event_type),
  INDEX idx_calendar_events_sync     (sync_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- 3. notifications
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id             INT UNSIGNED        NOT NULL,
  client_id           INT UNSIGNED        NULL,
  case_id             INT UNSIGNED        NULL,
  task_id             INT UNSIGNED        NULL,
  deadline_id         INT UNSIGNED        NULL,
  calendar_event_id   INT UNSIGNED        NULL,
  title               VARCHAR(255)        NOT NULL,
  message             TEXT                NOT NULL,
  notification_type   VARCHAR(100)        NOT NULL,
  channel             ENUM('sistema','som','telegram','whatsapp') NOT NULL DEFAULT 'sistema',
  status              ENUM('pendente','enviada','lida','erro') NOT NULL DEFAULT 'pendente',
  scheduled_at        DATETIME            NOT NULL,
  sent_at             DATETIME            NULL,
  error_message       TEXT                NULL,
  created_at          DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_notifications_user      (user_id),
  INDEX idx_notifications_status    (status),
  INDEX idx_notifications_scheduled (scheduled_at),
  INDEX idx_notifications_channel   (channel),
  INDEX idx_notifications_type      (notification_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- 4. notification_settings
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_settings (
  id                      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id                 INT UNSIGNED        NOT NULL,
  sound_enabled           TINYINT(1)          NOT NULL DEFAULT 1,
  telegram_enabled        TINYINT(1)          NOT NULL DEFAULT 0,
  whatsapp_enabled        TINYINT(1)          NOT NULL DEFAULT 0,
  reminder_minutes_before INT                 NOT NULL DEFAULT 15,
  created_at              DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_notification_settings_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- 5. telegram_settings
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS telegram_settings (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED  NOT NULL,
  bot_token   VARCHAR(500)  NULL,
  chat_id     VARCHAR(100)  NULL,
  enabled     TINYINT(1)    NOT NULL DEFAULT 0,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_telegram_settings_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- 6. task_deadline_counters
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_deadline_counters (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id           INT UNSIGNED        NULL,
  deadline_id       INT UNSIGNED        NULL,
  days_remaining    INT                 NOT NULL DEFAULT 0,
  hours_remaining   INT                 NOT NULL DEFAULT 0,
  status_label      ENUM('vencido','urgente','atencao','normal') NOT NULL DEFAULT 'normal',
  last_calculated_at DATETIME           NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_tdc_task     (task_id),
  INDEX idx_tdc_deadline (deadline_id),
  INDEX idx_tdc_status   (status_label),
  INDEX idx_tdc_calc     (last_calculated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- Default notification settings for existing users
-- (run after creating the table)
-- ─────────────────────────────────────────
INSERT IGNORE INTO notification_settings (user_id, sound_enabled, telegram_enabled, reminder_minutes_before)
SELECT id, 1, 0, 15 FROM users;
