-- ============================================================
-- Migration 047 — Tipo de peca nos modelos do escritorio
-- Liga a biblioteca de modelos (document_templates) a IA: um modelo pode
-- ser marcado como PECA e com o tipo (contestacao, replica, recurso, etc.),
-- para o Estagiario escolher o modelo certo e preencher com os autos.
-- IMPORTANTE: o runner divide por ';' e remove linhas iniciadas por '--',
-- entao nenhum conteudo abaixo contem ';' nem linha comecando com '--'.
-- ============================================================

ALTER TABLE document_templates
  ADD COLUMN piece_type VARCHAR(60) NULL
