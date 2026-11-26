-- ============================================================
-- Migration 191 - Link de consulta do protocolo do dativo (26/11/2026)
-- Pedido da Jessica: guardar o link de consulta direta que sai junto com o
-- codigo do protocolo do e-Flow (exemplo e-docs.es.gov.br/e/CODIGO).
-- So acrescenta a coluna: nenhum dado existente muda.
-- IMPORTANTE: o runner divide por ponto e virgula e remove linhas iniciadas
-- por dois tracos, entao nenhum conteudo abaixo contem esses caracteres.
-- ============================================================

ALTER TABLE dative_cases
  ADD COLUMN eflow_link VARCHAR(500) NULL AFTER eflow_protocolo;
