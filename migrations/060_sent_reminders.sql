-- ============================================================
-- Migration 060 — Controle de lembretes enviados (dedup)
-- Garante que a régua de cobrança e os alertas automáticos
-- nunca repetem o mesmo aviso (ref_key único por marco).
-- ============================================================

CREATE TABLE IF NOT EXISTS sent_reminders (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ref_key    VARCHAR(120) NOT NULL,
  channel    VARCHAR(20)  NOT NULL DEFAULT 'email',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sr_ref (ref_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
