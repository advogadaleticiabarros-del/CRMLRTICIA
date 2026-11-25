-- ============================================================
-- Migration 190 — Ponte do Obsidian (25/11/2026).
-- Último sinal de vida do programa do computador do escritório que mantém o
-- cofre e o CRM em dia (scripts/ponte-obsidian). Uma linha só (id = 1).
-- avisado_em: quando a queda (24 h sem sinal) foi avisada, para avisar uma vez.
-- Só acrescenta; nenhum dado existente muda.
-- ============================================================

CREATE TABLE IF NOT EXISTS obsidian_ponte_sinal (
  id           TINYINT UNSIGNED PRIMARY KEY,
  ultimo_sinal DATETIME     NOT NULL,
  versao       VARCHAR(20)  NULL,
  resumo       JSON         NULL,
  erro         VARCHAR(300) NULL,
  avisado_em   DATETIME     NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
