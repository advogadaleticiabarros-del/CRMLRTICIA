-- ============================================================
-- Migration 108 — Corrige o modelo "Aceite de Nomeação Dativa"
-- para seguir o formato oficialmente aceito pelo juízo (padrão
-- validado em processo real, ver Id. 105256697 do Processo
-- 5003987-16.2026.8.08.0012): cabeçalho "EXCELENTÍSSIMA(O)...",
-- citação da decisão (Id.), fundamento na Resolução 032/2018 do
-- TJES, dados de contato da advogada e pedido de prazo para
-- contestação. Também corrige o bug de duplicidade "OAB/ES ...
-- /ES" do modelo antigo (advogada_oab já vem com a UF).
-- Novos placeholders usados: dativo_decisao_id, advogada_telefone,
-- advogada_email (preenchidos automaticamente a partir do cadastro
-- da advogada em /api/documents/generate).
-- IMPORTANTE: o runner divide por ';' e remove linhas iniciadas por '--',
-- entao nenhum conteudo abaixo contem ';' nem linha comecando com '--'.
-- ============================================================

UPDATE document_templates SET content = 'EXCELENTÍSSIMA(O) SENHORA(OR) JUÍZA(ÍZ) DE DIREITO {{dativo_juizo}}\n\nProcesso nº {{processo_numero}}\n\n{{advogada_nome}}, advogada inscrita na OAB sob o nº {{advogada_oab}}, vem, respeitosamente, à presença de Vossa Excelência, em atenção à decisão proferida nos autos (Id. {{dativo_decisao_id}}), comunicar que ACEITA a nomeação como advogada dativa para patrocinar os interesses da parte {{dativo_parte}} {{cliente_nome}}, nos termos da Resolução nº 032/2018 do E. TJES.\n\nPara fins de comunicação processual, informa os seguintes dados de contato:\n\nTelefone: {{advogada_telefone}}\nE-mail: {{advogada_email}}\n\nRequer, ainda, a concessão de prazo para contato com a constituinte e posterior {{dativo_finalidade}}.\n\nTermos em que,\nPede deferimento.\n\n{{dativo_comarca}}, {{data_extenso}}.\n\n_______________________________________\n{{advogada_nome}}\nOAB nº {{advogada_oab}}' WHERE name = 'Aceite de Nomeação Dativa'
