-- ============================================================
-- Migration 013 — Módulo Financeiro Avançado
-- Integrado do server-legal-hub (schema.prisma → MySQL)
-- Inclui acordos, receitas, parcelas expandidas, recebimentos,
-- repasses de parceiros, inadimplências e perfil financeiro do cliente.
-- ============================================================

-- ─────────────────────────────────────────
-- agreements — acordos / settlements
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agreements (
  id                      INT UNSIGNED   AUTO_INCREMENT PRIMARY KEY,
  client_id               INT UNSIGNED   NOT NULL,
  case_id                 INT UNSIGNED   NULL,
  process_number          VARCHAR(100)   NULL,
  opposing_party          VARCHAR(255)   NOT NULL,
  total_agreement_value   DECIMAL(14,2)  NOT NULL,
  installments_count      INT            NOT NULL,
  first_due_date          DATE           NOT NULL,
  honorarium_percentage   DECIMAL(5,2)   NOT NULL,
  honorarium_value        DECIMAL(14,2)  NOT NULL,
  receiving_method        VARCHAR(50)    NOT NULL DEFAULT 'Acordo',
  status                  VARCHAR(50)    NOT NULL DEFAULT 'Proposto',
  -- Proposto | Aceito | Homologado | Em pagamento | Quitado | Descumprido
  notes                   TEXT           NULL,
  created_at              DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_agreements_client (client_id),
  INDEX idx_agreements_case   (case_id),
  INDEX idx_agreements_status (status),

  CONSTRAINT fk_agreements_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT fk_agreements_case   FOREIGN KEY (case_id)   REFERENCES cases(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- receitas — receitas geradas por cliente/caso
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS receitas (
  id               INT UNSIGNED   AUTO_INCREMENT PRIMARY KEY,
  case_id          INT UNSIGNED   NULL,
  client_id        INT UNSIGNED   NOT NULL,
  descricao        VARCHAR(500)   NOT NULL,
  tipo             VARCHAR(30)    NOT NULL DEFAULT 'servico',
  -- servico | reembolso | honorario
  valor            DECIMAL(14,2)  NOT NULL,
  status           VARCHAR(20)    NOT NULL DEFAULT 'aberto',
  -- aberto | parcial | recebido | cancelado
  data_vencimento  DATE           NOT NULL,
  data_emissao     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_recebido   DECIMAL(14,2)  NOT NULL DEFAULT 0,
  saldo_pendente   DECIMAL(14,2)  NULL,
  criado_por       INT UNSIGNED   NULL,
  created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_receitas_client  (client_id),
  INDEX idx_receitas_case    (case_id),
  INDEX idx_receitas_status  (status),
  INDEX idx_receitas_vencto  (data_vencimento),

  CONSTRAINT fk_receitas_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT fk_receitas_case   FOREIGN KEY (case_id)   REFERENCES cases(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- parcelas — parcelas expandidas de receitas (com juros/desconto)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parcelas (
  id               INT UNSIGNED   AUTO_INCREMENT PRIMARY KEY,
  receita_id       INT UNSIGNED   NOT NULL,
  numero           INT            NOT NULL,
  total_parcelas   INT            NOT NULL,
  valor            DECIMAL(14,2)  NOT NULL,
  juros            DECIMAL(14,2)  NOT NULL DEFAULT 0,
  desconto         DECIMAL(14,2)  NOT NULL DEFAULT 0,
  valor_final      DECIMAL(14,2)  NOT NULL,
  status           VARCHAR(20)    NOT NULL DEFAULT 'aberto',
  -- aberto | pago | atrasado | parcial
  data_vencimento  DATE           NOT NULL,
  data_pagamento   DATETIME       NULL,
  comprovante      VARCHAR(1000)  NULL,
  criado_em        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_parcelas_receita (receita_id),
  INDEX idx_parcelas_status  (status),
  INDEX idx_parcelas_vencto  (data_vencimento),

  CONSTRAINT fk_parcelas_receita FOREIGN KEY (receita_id) REFERENCES receitas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- recebimentos — registros de pagamento por parcela
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recebimentos (
  id          INT UNSIGNED   AUTO_INCREMENT PRIMARY KEY,
  parcela_id  INT UNSIGNED   NOT NULL,
  data        DATETIME       NOT NULL,
  valor       DECIMAL(14,2)  NOT NULL,
  metodo      VARCHAR(30)    NOT NULL,
  -- pix | transferencia | boleto | cartao | cheque | dinheiro
  comprovante VARCHAR(1000)  NULL,
  criado_em   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_recebimentos_parcela (parcela_id),
  INDEX idx_recebimentos_data    (data),

  CONSTRAINT fk_recebimentos_parcela FOREIGN KEY (parcela_id) REFERENCES parcelas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- repasses — repasse a parceiros por caso
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS repasses (
  id               INT UNSIGNED   AUTO_INCREMENT PRIMARY KEY,
  case_id          INT UNSIGNED   NOT NULL,
  parceiro         VARCHAR(255)   NOT NULL,
  tipo             VARCHAR(30)    NOT NULL DEFAULT 'indicacao',
  -- indicacao | audiencia | correspondente | diligencia
  valor            DECIMAL(14,2)  NOT NULL,
  percentual       DECIMAL(5,2)   NULL,
  descricao        TEXT           NOT NULL,
  status           VARCHAR(20)    NOT NULL DEFAULT 'pendente',
  -- pendente | processando | repassado | cancelado
  data_vencimento  DATE           NOT NULL,
  data_repasse     DATETIME       NULL,
  criado_em        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_repasses_case   (case_id),
  INDEX idx_repasses_status (status),
  INDEX idx_repasses_parceiro (parceiro(100)),

  CONSTRAINT fk_repasses_case FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- inadimplencias — controle de inadimplência por parcela
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inadimplencias (
  id                   INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  parcela_id           INT UNSIGNED  NOT NULL,
  client_id            INT UNSIGNED  NOT NULL,
  dias_atraso          INT           NOT NULL,
  valor                DECIMAL(14,2) NOT NULL,
  status               VARCHAR(30)   NOT NULL DEFAULT 'alerta_1d',
  -- alerta_1d | alerta_5d | alerta_10d | alerta_15d | alerta_30d
  -- | cobranca_juridica | negociando | resolvido
  ultimo_alerta        DATETIME      NULL,
  tentativas_cobranca  INT           NOT NULL DEFAULT 0,
  data_resolucao       DATETIME      NULL,
  criado_em            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_inadimplencia_parcela (parcela_id),
  INDEX idx_inadimplencias_client (client_id),
  INDEX idx_inadimplencias_status (status),

  CONSTRAINT fk_inadimplencias_parcela FOREIGN KEY (parcela_id)  REFERENCES parcelas(id)  ON DELETE CASCADE,
  CONSTRAINT fk_inadimplencias_client  FOREIGN KEY (client_id)   REFERENCES clients(id)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- client_financial_profiles — perfil financeiro do cliente
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_financial_profiles (
  id                  INT UNSIGNED   AUTO_INCREMENT PRIMARY KEY,
  client_id           INT UNSIGNED   NOT NULL,
  limite_credito      DECIMAL(14,2)  NULL,
  dias_prazo          INT            NOT NULL DEFAULT 30,
  condicao_honorario  VARCHAR(20)    NOT NULL DEFAULT 'inicial',
  -- inicial | mensal | unico | exito | hibrido | acordo
  total_faturado      DECIMAL(14,2)  NOT NULL DEFAULT 0,
  total_recebido      DECIMAL(14,2)  NOT NULL DEFAULT 0,
  saldo_pendente      DECIMAL(14,2)  NOT NULL DEFAULT 0,
  taxa_adimplencia    DECIMAL(5,2)   NOT NULL DEFAULT 100,
  inadimplencias      INT            NOT NULL DEFAULT 0,
  ultima_transacao    DATETIME       NULL,
  criado_em           DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_cfp_client (client_id),

  CONSTRAINT fk_cfp_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- financial_audit_logs — trilha de auditoria financeira
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS financial_audit_logs (
  id             INT UNSIGNED   AUTO_INCREMENT PRIMARY KEY,
  entity_type    VARCHAR(50)    NOT NULL,
  -- Receita | Installment | Expense | Agreement | Repasse
  entity_id      INT UNSIGNED   NOT NULL,
  action         VARCHAR(100)   NOT NULL,
  user_id        INT UNSIGNED   NULL,
  user_name      VARCHAR(255)   NULL,
  client_id      INT UNSIGNED   NULL,
  case_id        INT UNSIGNED   NULL,
  receita_id     INT UNSIGNED   NULL,
  installment_id INT UNSIGNED   NULL,
  parcela_id     INT UNSIGNED   NULL,
  expense_id     INT UNSIGNED   NULL,
  agreement_id   INT UNSIGNED   NULL,
  repasse_id     INT UNSIGNED   NULL,
  old_value      DECIMAL(14,2)  NULL,
  new_value      DECIMAL(14,2)  NULL,
  old_due_date   DATE           NULL,
  new_due_date   DATE           NULL,
  old_status     VARCHAR(50)    NULL,
  new_status     VARCHAR(50)    NULL,
  reason         TEXT           NULL,
  ip_address     VARCHAR(45)    NULL,
  created_at     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_fal_entity     (entity_type, entity_id),
  INDEX idx_fal_user       (user_id),
  INDEX idx_fal_client     (client_id),
  INDEX idx_fal_case       (case_id),
  INDEX idx_fal_created    (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
