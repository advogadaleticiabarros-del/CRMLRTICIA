-- ============================================================
-- Migration 115 — "Termos em que, / Pede deferimento" centralizado
-- Mantém as duas linhas empilhadas (uma embaixo da outra), só
-- centralizadas na página, usando o marcador <<CENTRO>> já existente.
-- IMPORTANTE: o runner divide por ';' e remove linhas iniciadas por '--',
-- entao nenhum conteudo abaixo contem ';' nem linha comecando com '--'.
-- ============================================================

UPDATE document_templates SET content = 'AO JUÍZO {{dativo_juizo}}\n\nProcesso nº {{processo_numero}}\n\n{{advogada_nome}}, advogada inscrita na OAB sob o nº {{advogada_oab}}, vem, respeitosamente, à presença de Vossa Excelência, em atenção à decisão proferida nos autos (Id. {{dativo_decisao_id}}), comunicar que ACEITA a nomeação como advogada dativa para patrocinar os interesses da parte {{dativo_parte}} {{cliente_nome}}, nos termos da Resolução nº 032/2018 do E. TJES.\n\nPara fins de comunicação processual, informa os seguintes dados de contato:\n\nTelefone: (27) 99515-1402 | (44) 99101-1402\nE-mail: advogadaleticia.barros@gmail.com\n\n<<CENTRO>>Termos em que,<<CENTRO>>\n<<CENTRO>>Pede deferimento.<<CENTRO>>\n\n<<DIREITA>>{{dativo_comarca}}, {{data_extenso}}.<<DIREITA>>\n\n<<ASSINATURA-SEM-LINHA>>\n{{advogada_nome}}\nOAB nº {{advogada_oab}}' WHERE name = 'Aceite de Nomeação Dativa'
