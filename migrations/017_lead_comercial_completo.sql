-- ============================================================
-- Migration 017 — CRM Comercial completo (Fase 1)
-- Campos completos do lead (pessoais, endereço, comercial) +
-- expansão aditiva do pipeline (novos estágios + 'convertido').
-- ============================================================

ALTER TABLE leads
  ADD COLUMN cpf_cnpj          VARCHAR(20)   NULL,
  ADD COLUMN rg                VARCHAR(30)   NULL,
  ADD COLUMN birth_date        DATE          NULL,
  ADD COLUMN marital_status    VARCHAR(30)   NULL,
  ADD COLUMN profession        VARCHAR(120)  NULL,
  ADD COLUMN cep               VARCHAR(12)   NULL,
  ADD COLUMN street            VARCHAR(255)  NULL,
  ADD COLUMN number            VARCHAR(20)   NULL,
  ADD COLUMN neighborhood      VARCHAR(120)  NULL,
  ADD COLUMN city              VARCHAR(120)  NULL,
  ADD COLUMN state             VARCHAR(2)    NULL,
  ADD COLUMN case_summary      TEXT          NULL,
  ADD COLUMN estimated_value   DECIMAL(14,2) NULL,
  ADD COLUMN close_probability INT           NULL,
  ADD COLUMN next_followup     DATE          NULL,
  ADD COLUMN loss_reason       VARCHAR(255)  NULL;

-- Pipeline ampliado (aditivo — mantém os estágios atuais; volta 'convertido')
ALTER TABLE leads MODIFY COLUMN status
  ENUM('triagem','atendimento_inicial','reuniao','documentacao_pendente',
       'proposta','proposta_em_analise','contrato_assinado','fechada','convertido','perdida')
  NOT NULL DEFAULT 'triagem';
