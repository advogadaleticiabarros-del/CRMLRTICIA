-- ============================================================
-- Migration 127 — Fatura do Cartão (import do CSV da fatura Nubank)
-- Pedido da Dra. Letícia: nova seção em Financeiro pra ver os gastos da
-- fatura de crédito categorizados (mercado, farmácia, compras online...).
--
-- DELIBERADAMENTE não usa cashflow_entries: o valor da fatura já entra
-- uma vez como saída no Extrato Consolidado ("Pagamento de fatura", ao
-- pagar o cartão pela conta corrente). Se cada compra individual daqui
-- também virasse um lançamento de saída, o saldo real dobraria a conta.
-- Esta tabela é só o DETALHAMENTO de uma saída que já existe em outro
-- lugar — nunca entra em getConsolidatedSummary/getMonthlyCashflow.
--
-- row_hash: o CSV da fatura não tem um Identificador único por linha
-- (diferente do extrato da conta) — o hash de
-- data+título+valor+mês_da_fatura é a chave de dedup.
-- ============================================================

CREATE TABLE IF NOT EXISTS card_statement_entries (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  purchase_date         DATE          NOT NULL,
  title                 VARCHAR(255)  NOT NULL,
  amount                DECIMAL(12,2) NOT NULL COMMENT 'positivo = compra; negativo = pagamento/estorno (reduz a fatura)',
  is_payment_or_refund  TINYINT(1)    NOT NULL DEFAULT 0,
  installment_no        INT UNSIGNED  NULL,
  installment_total     INT UNSIGNED  NULL,
  category              VARCHAR(40)   NULL,
  review_status         VARCHAR(12)   NOT NULL DEFAULT 'ok' COMMENT 'ok | pendente',
  bill_ref_month        CHAR(7)       NOT NULL COMMENT 'YYYY-MM — mês/ano de vencimento da fatura (do nome do arquivo)',
  row_hash              CHAR(64)      NOT NULL,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE INDEX uq_card_row_hash (row_hash),
  INDEX idx_card_bill_month (bill_ref_month),
  INDEX idx_card_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Regras de categorização por comerciante — mesmo princípio do
-- bank_statement_rules (1 linha por padrão, contains case-insensitive).
CREATE TABLE IF NOT EXISTS card_statement_rules (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  match_value  VARCHAR(200)  NOT NULL,
  category     VARCHAR(40)   NOT NULL,
  label_override VARCHAR(200) NULL,
  active       TINYINT(1)    NOT NULL DEFAULT 1,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX uq_card_rule (match_value, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS card_statement_imports (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  filename        VARCHAR(255) NULL,
  bill_ref_month  CHAR(7)      NOT NULL,
  total_rows      INT UNSIGNED NOT NULL DEFAULT 0,
  imported_rows   INT UNSIGNED NOT NULL DEFAULT 0,
  duplicate_rows  INT UNSIGNED NOT NULL DEFAULT 0,
  pending_rows    INT UNSIGNED NOT NULL DEFAULT 0,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_csi_month (bill_ref_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed de categorias por comerciante — a partir da fatura real de
-- setembro/2026 (vencimento 08/09), padrões óbvios pelo nome.
INSERT INTO card_statement_rules (match_value, category, label_override) VALUES
  ('DROGASIL',              'farmacia',       NULL),
  ('RAIA DROGASIL',         'farmacia',       NULL),
  ('PAGUE MENOSA',          'farmacia',       NULL),
  ('SUPERMERCADO',          'mercado',        NULL),
  ('SUPERMERCADOS BH',      'mercado',        NULL),
  ('PADARIA',               'mercado',        NULL),
  ('PANIFICADORA',          'mercado',        NULL),
  ('BURGER KING',           'alimentacao',    NULL),
  ('SHEIN',                 'compras_online', NULL),
  ('TIKTOK',                'compras_online', NULL),
  ('AMAZON',                'compras_online', NULL),
  ('MARISA',                'vestuario',      NULL),
  ('CEA ',                  'vestuario',      NULL),
  ('PETROBRAS',             'combustivel',    NULL),
  ('POSTO',                 'combustivel',    NULL),
  ('ESTACIONAMENTO',        'transporte',     NULL),
  ('GOL LINHAS',            'viagem',         NULL),
  ('GLOBO GLOBOPLAY',       'assinaturas',    NULL),
  ('STILO PET',             'pet',            NULL),
  ('ATACAPET',              'pet',            NULL),
  ('APP VIVO',              'assinaturas',    NULL)
ON DUPLICATE KEY UPDATE active = 1;
