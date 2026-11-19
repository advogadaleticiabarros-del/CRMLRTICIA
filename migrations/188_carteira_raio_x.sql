-- ============================================================
-- Migration 188 — Raio-x da carteira (19/11/2026, Dr. Vitor).
-- Um registro por dia com a saude da carteira e a lista de pendencias
-- (JSON), para comparar com o dia anterior (novas, pioraram, resolvidas)
-- e mostrar a pauta na ficha do Dr. Vitor. So cria tabela nova.
-- ============================================================

CREATE TABLE IF NOT EXISTS carteira_raio_x (
  dia         DATE         NOT NULL PRIMARY KEY,
  saude       TINYINT      NOT NULL,
  processos   INT          NOT NULL,
  casos       INT          NOT NULL,
  em_dia      INT          NOT NULL,
  pendencias  JSON         NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
