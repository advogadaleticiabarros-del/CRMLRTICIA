-- ============================================================
-- Migration 120 — Valor arbitrado de honorários dativos
-- Quando o monitoramento (DJEN/OAB) encontra uma publicação com a
-- decisão que ARBITRA o valor dos honorários dativos (evento
-- separado da nomeação, chega depois no andamento do processo), o
-- sistema grava o valor extraído por IA aqui.
-- Coluna nova e independente de estimated_value: estimated_value e
-- preenchida manualmente pela usuaria (estimativa dela) e nao pode
-- ser sobrescrita silenciosamente por uma extracao automatica -
-- arbitrated_value guarda o que veio da decisao judicial de fato.
-- arbitrated_value_detected_at marca quando a deteccao automatica
-- gravou o valor, para dar contexto na tela (ex.: "detectado em
-- 30/08/2026" vs preenchido manualmente).
-- IMPORTANTE: o runner divide por ';' e remove linhas iniciadas por '--',
-- entao nenhum conteudo abaixo contem ';' nem linha comecando com '--'.
-- ============================================================

ALTER TABLE dative_cases
  ADD COLUMN arbitrated_value DECIMAL(12,2) NULL AFTER estimated_value,
  ADD COLUMN arbitrated_value_detected_at DATETIME NULL AFTER arbitrated_value
