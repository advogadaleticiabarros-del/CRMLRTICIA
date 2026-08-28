-- ============================================================
-- Migration 111 — Alinhamento do Aceite Dativo igual ao modelo em PDF
-- Usa os marcadores <<TITULO-CENTRO>>/<<CENTRO>>/<<DIREITA>> (só
-- funcionam quando o texto do modelo os contém — ver formatDocHtml
-- em public/app.js) pra deixar, na impressão/PDF, o cabeçalho do
-- juízo em negrito centralizado, o "Processo nº..." centralizado, e
-- a linha final de cidade/data alinhada à direita — só neste modelo,
-- os demais documentos do sistema não usam esses marcadores.
-- IMPORTANTE: o runner divide por ';' e remove linhas iniciadas por '--',
-- entao nenhum conteudo abaixo contem ';' nem linha comecando com '--'.
-- ============================================================

UPDATE document_templates SET content = '<<TITULO-CENTRO>>EXCELENTÍSSIMA(O) SENHORA(OR) JUÍZA(ÍZ) DE DIREITO {{dativo_juizo}}<<TITULO-CENTRO>>\n\n<<CENTRO>>Processo nº {{processo_numero}}<<CENTRO>>\n\n{{advogada_nome}}, advogada inscrita na OAB sob o nº {{advogada_oab}}, vem, respeitosamente, à presença de Vossa Excelência, em atenção à decisão proferida nos autos (Id. {{dativo_decisao_id}}), comunicar que ACEITA a nomeação como advogada dativa para patrocinar os interesses da parte {{dativo_parte}} {{cliente_nome}}, nos termos da Resolução nº 032/2018 do E. TJES.\n\nPara fins de comunicação processual, informa os seguintes dados de contato:\n\nTelefone: {{advogada_telefone}}\nE-mail: {{advogada_email}}\n\nRequer, ainda, a concessão de prazo para contato com a constituinte e posterior apresentação de contestação.\n\nTermos em que,\nPede deferimento.\n\n<<DIREITA>>{{dativo_comarca}}, {{data_extenso}}.<<DIREITA>>\n\n_______________________________________\n{{advogada_nome}}\nOAB nº {{advogada_oab}}' WHERE name = 'Aceite de Nomeação Dativa'
