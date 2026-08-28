-- ============================================================
-- Migration 112 — Ajustes no Aceite Dativo: cabeçalho "AO JUÍZO"
-- de volta a texto normal (sem negrito/centralizado), "Processo
-- nº" também volta a texto normal, e remove o parágrafo de pedido
-- de prazo para contestação ("Requer, ainda..."). A linha final de
-- cidade/data continua alinhada à direita (<<DIREITA>>).
-- IMPORTANTE: o runner divide por ';' e remove linhas iniciadas por '--',
-- entao nenhum conteudo abaixo contem ';' nem linha comecando com '--'.
-- ============================================================

UPDATE document_templates SET content = 'AO JUÍZO {{dativo_juizo}}\n\nProcesso nº {{processo_numero}}\n\n{{advogada_nome}}, advogada inscrita na OAB sob o nº {{advogada_oab}}, vem, respeitosamente, à presença de Vossa Excelência, em atenção à decisão proferida nos autos (Id. {{dativo_decisao_id}}), comunicar que ACEITA a nomeação como advogada dativa para patrocinar os interesses da parte {{dativo_parte}} {{cliente_nome}}, nos termos da Resolução nº 032/2018 do E. TJES.\n\nPara fins de comunicação processual, informa os seguintes dados de contato:\n\nTelefone: {{advogada_telefone}}\nE-mail: {{advogada_email}}\n\nTermos em que,\nPede deferimento.\n\n<<DIREITA>>{{dativo_comarca}}, {{data_extenso}}.<<DIREITA>>\n\n_______________________________________\n{{advogada_nome}}\nOAB nº {{advogada_oab}}' WHERE name = 'Aceite de Nomeação Dativa'
