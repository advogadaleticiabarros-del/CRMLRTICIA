-- ============================================================
-- Migration 083 — Modelo "Aceite de Nomeação Dativa"
-- Mesmo mecanismo de Procuração/Contrato (document_templates,
-- gerado em Documentos > Gerar documento, ou pelo botão na própria
-- demanda dativa). dativo_juizo/dativo_parte/dativo_finalidade/
-- dativo_comarca são campos extras (POST /generate aceita "extra")
-- porque variam caso a caso e não têm coluna fixa no cadastro.
-- IMPORTANTE: o runner divide por ';' e remove linhas iniciadas por '--',
-- entao nenhum conteudo abaixo contem ';' nem linha comecando com '--'.
-- ============================================================

INSERT INTO document_templates (name, category, content) VALUES ('Aceite de Nomeação Dativa', 'processos', 'AO JUÍZO {{dativo_juizo}}\n\nProcesso nº {{processo_numero}}\n\n{{advogada_nome}}, advogada, inscrita na OAB/ES sob o nº {{advogada_oab}}, nomeada defensora dativa da parte {{dativo_parte}} {{cliente_nome}}, vem, respeitosamente, à presença de Vossa Excelência, manifestar sua\n\nACEITAÇÃO DA NOMEAÇÃO\n\nA subscritora aceita o encargo de defensora dativa para {{dativo_finalidade}}.\n\n{{dativo_comarca}}, {{data_extenso}}.\n\n_______________________________________\n{{advogada_nome}}\nAdvogada – OAB/ES nº {{advogada_oab}}')
