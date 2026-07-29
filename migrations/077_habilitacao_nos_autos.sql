-- ============================================================
-- Migration 077 — Modelo "Habilitação nos Autos"
-- Peça pra pedir a inclusão da advogada no cadastro processual quando o
-- escritório entra num processo já em curso (ex.: homologação de acordo
-- extrajudicial). Fica em document_templates, mesmo mecanismo de
-- Procuração/Contrato de Honorários — gerada em Documentos > Gerar documento.
-- IMPORTANTE: o runner divide por ';' e remove linhas iniciadas por '--',
-- entao nenhum conteudo abaixo contem ';' nem linha comecando com '--'.
-- ============================================================

INSERT INTO document_templates (name, category, content) VALUES ('Habilitação nos Autos', 'processos', 'AO JUÍZO DA {{juizo}}\n\nProcesso nº {{processo_numero}}\n\n{{cliente_nome}}, já qualificada nos autos do procedimento em epígrafe, por intermédio de sua advogada que esta subscreve, vem, respeitosamente, à presença de Vossa Excelência requerer sua:\n\nHABILITAÇÃO NOS AUTOS\n\nA Requerida constituiu como sua procuradora a advogada {{advogada_nome}}, inscrita na OAB sob o nº {{advogada_oab}}, conforme instrumento de procuração já juntado aos autos.\n\nDiante do exposto, requer a habilitação e a inclusão da patrona no cadastro processual da Requerida, para fins de acompanhamento do feito e recebimento das futuras intimações, bem como o regular prosseguimento do processo.\n\nTermos em que,\nPede deferimento.\n\n{{cliente_cidade}}, {{data_extenso}}.\n\n_______________________________________\n{{advogada_nome}}\nAdvogada – OAB nº {{advogada_oab}}')
