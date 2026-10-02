-- ============================================================
-- Migration 144 — Visitas ao link público da proposta
-- Pedido 01/10/2026: monitorar o link sempre (tempo dentro da proposta,
-- quantas vezes reabriu, até onde leu). Sem IP/localização (LGPD).
-- chave = identificador aleatório da visita, gerado no servidor.
-- ============================================================

CREATE TABLE IF NOT EXISTS proposta_visitas (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  proposta_id    INT UNSIGNED NOT NULL,
  chave          CHAR(36)     NOT NULL,
  iniciada_em    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_sinal_em DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  segundos       INT UNSIGNED NOT NULL DEFAULT 0,
  scroll_max     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  dispositivo    VARCHAR(20)  NOT NULL DEFAULT 'computador',
  UNIQUE KEY uq_pv_chave (chave),
  INDEX idx_pv_proposta (proposta_id, iniciada_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
