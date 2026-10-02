-- ============================================================
-- Migration 145 — Acordos detectados nas movimentações
-- Relato real 02/10/2026: acordos homologados não eram "puxados" — nenhuma
-- regra lia homologação de acordo/transação. Fila de acordos a registrar,
-- um por processo. status: pendente | registrado | descartado.
-- ============================================================

CREATE TABLE IF NOT EXISTS acordos_detectados (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  process_id     INT UNSIGNED NOT NULL,
  movement_id    INT UNSIGNED NULL,
  tipo           VARCHAR(20)  NOT NULL,
  trecho         TEXT         NULL,
  valor_sugerido DECIMAL(14,2) NULL,
  status         VARCHAR(20)  NOT NULL DEFAULT 'pendente',
  agreement_id   INT UNSIGNED NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolvido_em   DATETIME     NULL,
  UNIQUE KEY uq_acd_process (process_id),
  INDEX idx_acd_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
