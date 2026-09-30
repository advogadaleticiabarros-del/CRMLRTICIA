-- ============================================================
-- Migration 140 — Vigia da carteira (caso parado + prescrição)
-- Diagnóstico ago/2026, IA proativa: varredura diária sem precisar de evento.
-- cases ganha a data-limite prescricional informada pela advogada (com a
-- data do fato gerador e a base legal usada, só para conferência).
-- vigia_alertas garante um aviso por marco (ref + marco únicos).
-- ============================================================

ALTER TABLE cases
  ADD COLUMN prescricao_fato_gerador DATE NULL,
  ADD COLUMN prescricao_data DATE NULL,
  ADD COLUMN prescricao_base VARCHAR(255) NULL
;

CREATE TABLE IF NOT EXISTS vigia_alertas (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ref        VARCHAR(80)  NOT NULL,
  marco      SMALLINT     NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vigia_ref_marco (ref, marco)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
