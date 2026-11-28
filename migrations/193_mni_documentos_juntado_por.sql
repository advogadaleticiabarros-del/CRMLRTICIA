-- ============================================================
-- Migration 193 - Quem juntou cada documento (28/11/2026)
-- Conferido no PJe do TJES: o tribunal nao manda a assinatura, mas manda o
-- nome e o CPF de quem juntou o documento. juntado_por guarda o nome, para
-- a baixa automatica saber se a peticao foi da nossa parte ou da outra.
-- O CPF nao e guardado (so serve para comparar com o login da Dra.).
-- So acrescenta a coluna: nenhum dado existente muda.
-- IMPORTANTE: o runner divide por ponto e virgula e remove linhas iniciadas
-- por dois tracos, entao nenhum conteudo abaixo contem esses caracteres.
-- ============================================================

ALTER TABLE mni_documentos
  ADD COLUMN juntado_por VARCHAR(200) NULL AFTER assinado_pelo_login;
