-- ============================================================
-- Migration 076 — Acordo Extrajudicial (cliente x empresa)
-- Qualificacao completa da empresa/advogado da parte contraria, forma de
-- pagamento, fluxo do dinheiro (direto ao cliente ou via escritorio com
-- repasse), o modelo do Termo de Acordo Extrajudicial gerado pelo sistema,
-- e upload de minuta propria (arquivo salvo no banco, mesmo padrao ja usado
-- pela midia recebida no WhatsApp).
-- IMPORTANTE: o runner divide por ';' e remove linhas iniciadas por '--',
-- entao nenhum conteudo abaixo contem ';' nem linha comecando com '--'.
-- ============================================================

ALTER TABLE agreements
  ADD COLUMN is_extrajudicial BOOLEAN NOT NULL DEFAULT 0,
  ADD COLUMN opposing_cnpj VARCHAR(20) NULL,
  ADD COLUMN opposing_address VARCHAR(500) NULL,
  ADD COLUMN opposing_legal_rep_name VARCHAR(255) NULL,
  ADD COLUMN opposing_legal_rep_cpf VARCHAR(20) NULL,
  ADD COLUMN opposing_lawyer_name VARCHAR(255) NULL,
  ADD COLUMN opposing_lawyer_oab VARCHAR(30) NULL,
  ADD COLUMN payment_method VARCHAR(30) NULL,
  ADD COLUMN payment_flow VARCHAR(20) NOT NULL DEFAULT 'direto_cliente',
  ADD COLUMN agreement_object TEXT NULL,
  ADD COLUMN penalty_percentage DECIMAL(5,2) NULL,
  ADD COLUMN jurisdiction_forum VARCHAR(255) NULL,
  ADD COLUMN minuta_document_id INT UNSIGNED NULL;

CREATE TABLE IF NOT EXISTS agreement_client_payouts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agreement_id INT UNSIGNED NOT NULL,
  tranche_label VARCHAR(60) NOT NULL,
  valor_bruto DECIMAL(14,2) NOT NULL,
  valor_honorarios DECIMAL(14,2) NOT NULL DEFAULT 0,
  valor_liquido DECIMAL(14,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pendente',
  data_prevista DATE NULL,
  data_repasse DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_payout_agreement (agreement_id),
  INDEX idx_payout_status (status),
  CONSTRAINT fk_payout_agreement FOREIGN KEY (agreement_id) REFERENCES agreements(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE documents
  ADD COLUMN data LONGBLOB NULL,
  ADD COLUMN mime VARCHAR(120) NULL;

INSERT INTO document_templates (name, category, content) VALUES ('Termo de Acordo Extrajudicial', 'acordos', 'TERMO DE ACORDO EXTRAJUDICIAL\n\nPRIMEIRO ACORDANTE: {{empresa_nome}}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº {{empresa_cnpj}}, com sede em {{empresa_endereco}}, neste ato representada por {{empresa_representante_nome}}, inscrito(a) no CPF sob o nº {{empresa_representante_cpf}}{{empresa_advogado_texto}}.\n\nSEGUNDO ACORDANTE: {{cliente_nome}}, {{cliente_estado_civil}}, {{cliente_profissao}}, inscrito(a) no CPF sob o nº {{cliente_cpf}}, residente e domiciliado(a) em {{cliente_endereco}}, {{cliente_cidade}}/{{cliente_estado}}, neste ato assistido(a) por {{advogada_nome}}, advogada inscrita na OAB sob o nº {{advogada_oab}}.\n\nAs partes acima identificadas têm, entre si, justo e acertado o presente Termo de Acordo Extrajudicial, que se regerá pelas cláusulas seguintes.\n\n1 - DO OBJETO DO ACORDO\nCláusula 1ª. {{acordo_objeto}}\n\n2 - DO VALOR E DA FORMA DE PAGAMENTO\nCláusula 2ª. As partes fixam o valor do presente acordo em {{acordo_valor_total}}, a ser pago por {{acordo_forma_pagamento}}, conforme o seguinte cronograma: {{acordo_cronograma}}\n\n3 - DA QUITAÇÃO\nCláusula 3ª. Cumpridas as obrigações previstas neste instrumento, as partes outorgam, uma à outra, a mais ampla, geral, irrevogável e irretratável quitação quanto ao objeto deste acordo, nada mais tendo a reclamar, em juízo ou fora dele, a qualquer título, em relação à matéria aqui tratada.\n\n{{acordo_clausula_penal}}\n\n5 - DO FORO\nCláusula 5ª. Fica eleito o foro de {{acordo_foro}} para dirimir quaisquer dúvidas oriundas do presente instrumento.\n\nPor estarem assim justos e acordados, firmam o presente instrumento em 2 (duas) vias de igual teor, na presença das testemunhas abaixo.\n\n{{cliente_cidade}}, {{data_extenso}}.\n\n_______________________________________\nPRIMEIRO ACORDANTE — {{empresa_nome}}\n\n_______________________________________\nSEGUNDO ACORDANTE — {{cliente_nome}}\n\n_______________________________________\nTESTEMUNHA (1) — CPF:\n\n_______________________________________\nTESTEMUNHA (2) — CPF:')
