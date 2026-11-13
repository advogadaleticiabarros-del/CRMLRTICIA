-- Fechamento de caso de parceria com RPV (pedido da Jessica, 13/11/2026).
-- A Dra. saca o RPV, a parceira paga a cliente e manda recibo e vídeo-depoimento.
-- Um fechamento por caso: valores da divisão, datas, comprovantes (documents) e os
-- lançamentos que ele gerou (financial_records e repasses), para editar sem duplicar.
-- Só cria tabela nova: nada muda nos dados existentes.
CREATE TABLE IF NOT EXISTS parceria_fechamentos (
  id                      INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  case_id                 INT UNSIGNED  NOT NULL,
  partner_id              INT UNSIGNED  NULL,
  valor_sacado            DECIMAL(14,2) NOT NULL,
  honorarios_percentual   DECIMAL(5,2)  NOT NULL,
  parceira_percentual     DECIMAL(5,2)  NOT NULL,
  honorarios              DECIMAL(14,2) NOT NULL,
  valor_cliente           DECIMAL(14,2) NOT NULL,
  valor_parceira          DECIMAL(14,2) NOT NULL,
  valor_repasse           DECIMAL(14,2) NOT NULL,
  valor_escritorio        DECIMAL(14,2) NOT NULL,
  data_saque              DATE          NULL,
  data_repasse            DATE          NULL,
  data_pagamento_cliente  DATE          NULL,
  recibo_document_id      INT UNSIGNED  NULL,
  video_document_id       INT UNSIGNED  NULL,
  receita_id              INT UNSIGNED  NULL,
  repasse_id              INT UNSIGNED  NULL,
  observacoes             TEXT          NULL,
  created_by              INT UNSIGNED  NULL,
  created_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_parceria_fechamento_case (case_id),
  INDEX idx_parceria_fechamento_partner (partner_id),
  CONSTRAINT fk_parceria_fechamento_case FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
