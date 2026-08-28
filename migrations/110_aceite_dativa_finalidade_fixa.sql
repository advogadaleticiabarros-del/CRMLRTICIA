-- ============================================================
-- Migration 110 — Fixa "apresentação de contestação" no Aceite Dativo
-- No modelo padrão confirmado pela advogada, só variam por caso: o
-- juízo, o Id da decisão de nomeação e a qualificação/nome da parte
-- assistida. O restante do texto (inclusive "posterior apresentação
-- de contestação") é sempre igual — deixa de ser um campo do
-- formulário ({{dativo_finalidade}}) e vira texto fixo no modelo.
-- IMPORTANTE: o runner divide por ';' e remove linhas iniciadas por '--',
-- entao nenhum conteudo abaixo contem ';' nem linha comecando com '--'.
-- ============================================================

UPDATE document_templates SET content = 'EXCELENTÍSSIMA(O) SENHORA(OR) JUÍZA(ÍZ) DE DIREITO {{dativo_juizo}}\n\nProcesso nº {{processo_numero}}\n\n{{advogada_nome}}, advogada inscrita na OAB sob o nº {{advogada_oab}}, vem, respeitosamente, à presença de Vossa Excelência, em atenção à decisão proferida nos autos (Id. {{dativo_decisao_id}}), comunicar que ACEITA a nomeação como advogada dativa para patrocinar os interesses da parte {{dativo_parte}} {{cliente_nome}}, nos termos da Resolução nº 032/2018 do E. TJES.\n\nPara fins de comunicação processual, informa os seguintes dados de contato:\n\nTelefone: {{advogada_telefone}}\nE-mail: {{advogada_email}}\n\nRequer, ainda, a concessão de prazo para contato com a constituinte e posterior apresentação de contestação.\n\nTermos em que,\nPede deferimento.\n\n{{dativo_comarca}}, {{data_extenso}}.\n\n_______________________________________\n{{advogada_nome}}\nOAB nº {{advogada_oab}}' WHERE name = 'Aceite de Nomeação Dativa'
