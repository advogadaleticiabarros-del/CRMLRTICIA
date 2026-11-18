-- ============================================================
-- Migration 182 — Agente de prazos, Dra. Paula (18/11/2026)
-- detected_deadlines: quando o agente examinou a intimacao e o que concluiu
--   (para nao repetir a cada rodada).
-- deadlines: de onde veio o prazo (regra ou leitura da IA), ate qual
--   movimentacao o agente ja leu, e a prova quando ele marca cumprido.
-- So acrescenta colunas: nenhum dado existente e apagado.
-- IMPORTANTE: o runner divide por ponto e virgula e remove linhas iniciadas
-- por dois tracos, entao nenhum conteudo abaixo contem esses caracteres.
-- ============================================================

ALTER TABLE detected_deadlines
  ADD COLUMN agente_em DATETIME NULL,
  ADD COLUMN agente_nota VARCHAR(600) NULL;

ALTER TABLE deadlines
  ADD COLUMN agente_origem VARCHAR(20) NULL,
  ADD COLUMN agente_ultimo_mov INT UNSIGNED NULL,
  ADD COLUMN cumprido_em DATETIME NULL,
  ADD COLUMN cumprido_evidencia VARCHAR(600) NULL;
