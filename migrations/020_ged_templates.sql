-- ============================================================
-- Migration 020 — GED + Templates jurídicos (Fase 3)
-- Pastas automáticas por cliente + modelos com placeholders {{...}}.
-- (Sem ponto-e-vírgula dentro dos conteúdos: o runner divide por ';'.)
-- ============================================================

CREATE TABLE IF NOT EXISTS document_templates (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  category    VARCHAR(60)  NOT NULL DEFAULT 'outros',
  content     LONGTEXT     NOT NULL,
  created_by  INT UNSIGNED NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE documents
  ADD COLUMN folder      VARCHAR(60)   NULL,
  ADD COLUMN content     LONGTEXT      NULL,
  ADD COLUMN template_id INT UNSIGNED  NULL,
  ADD COLUMN file_url    VARCHAR(1000) NULL,
  ADD COLUMN created_by  INT UNSIGNED  NULL;

INSERT INTO document_templates (name, category, content) VALUES
('Procuração Ad Judicia', 'procuracoes',
 'PROCURAÇÃO\n\nOUTORGANTE: {{cliente_nome}}, {{cliente_estado_civil}}, {{cliente_profissao}}, inscrito(a) no CPF sob o nº {{cliente_cpf}}, residente e domiciliado(a) em {{cliente_endereco}}, {{cliente_cidade}}/{{cliente_estado}}.\n\nOUTORGADO(A): {{advogada_nome}}, advogada inscrita na OAB sob o nº {{advogada_oab}}.\n\nPODERES: Pelo presente instrumento, o(a) outorgante nomeia e constitui sua bastante procuradora a outorgada, conferindo-lhe os poderes da cláusula ad judicia et extra, para o foro em geral, podendo propor as ações cabíveis, defender direitos, transigir, firmar acordos e substabelecer.\n\n{{cliente_cidade}}, {{data_extenso}}.\n\n_______________________________________\n{{cliente_nome}}'),
('Contrato de Honorários Advocatícios', 'contratos',
 'CONTRATO DE HONORÁRIOS ADVOCATÍCIOS\n\nCONTRATANTE: {{cliente_nome}}, CPF {{cliente_cpf}}, residente em {{cliente_endereco}}, {{cliente_cidade}}/{{cliente_estado}}.\n\nCONTRATADA: {{advogada_nome}}, OAB {{advogada_oab}}.\n\nOBJETO: Prestação de serviços advocatícios referentes ao processo {{processo_numero}}.\n\nHONORÁRIOS: As partes ajustam os honorários conforme proposta aceita, podendo ser fixos, por êxito ou mistos, na forma e prazos acordados.\n\nFORO: Fica eleito o foro da comarca de {{cliente_cidade}}.\n\n{{cliente_cidade}}, {{data_extenso}}.\n\n____________________________        ____________________________\n      Contratante                              Contratada'),
('Declaração de Hipossuficiência', 'documentos_pessoais',
 'DECLARAÇÃO DE HIPOSSUFICIÊNCIA\n\nEu, {{cliente_nome}}, inscrito(a) no CPF sob o nº {{cliente_cpf}}, residente em {{cliente_endereco}}, {{cliente_cidade}}/{{cliente_estado}}, DECLARO, para os devidos fins de direito e sob as penas da lei, que não possuo condições de arcar com as custas e despesas processuais sem prejuízo do meu próprio sustento e de minha família, nos termos da Lei nº 1.060/50 e do art. 98 do CPC.\n\n{{cliente_cidade}}, {{data_extenso}}.\n\n_______________________________________\n{{cliente_nome}}');
