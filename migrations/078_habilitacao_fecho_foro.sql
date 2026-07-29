-- ============================================================
-- Migration 078 — Corrige o fecho do modelo "Habilitação nos Autos"
-- {{cliente_cidade}} sempre fica vazio (clients so tem campo address unico,
-- sem cidade separada) e, mesmo se nao ficasse, o fecho da peticao deve usar
-- a cidade do FORO (onde fica a vara), nao a cidade onde o cliente mora.
-- IMPORTANTE: o runner divide por ';' e remove linhas iniciadas por '--',
-- entao nenhum conteudo abaixo contem ';' nem linha comecando com '--'.
-- ============================================================

UPDATE document_templates
   SET content = REPLACE(content, '{{cliente_cidade}}, {{data_extenso}}.', 'Vitória/ES, {{data_extenso}}.')
 WHERE name = 'Habilitação nos Autos'
