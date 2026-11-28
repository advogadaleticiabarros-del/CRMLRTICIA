-- ============================================================
-- Migration 194 - Aviso de queda da ponte do TJES (28/11/2026)
-- Em 27/11 o computador do escritorio ficou desligado o dia todo e nenhuma
-- rodada do TJES rodou sem ninguem saber. A rotina mni:vigia-ponte avisa a
-- equipe uma vez por queda. ponte_aviso_em guarda quando avisou.
-- So acrescenta a coluna: nenhum dado existente muda.
-- IMPORTANTE: o runner divide por ponto e virgula e remove linhas iniciadas
-- por dois tracos, entao nenhum conteudo abaixo contem esses caracteres.
-- ============================================================

ALTER TABLE mni_credenciais
  ADD COLUMN ponte_aviso_em DATETIME NULL;
