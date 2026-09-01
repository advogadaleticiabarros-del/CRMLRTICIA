-- ============================================================
-- Migration 126 — Extrato Consolidado (import do CSV mensal do Nubank)
-- Pedido da Dra. Letícia: subir o extrato bancário todo fim de mês e ver
-- o balanço categorizado (receita de escritório, clientes recorrentes,
-- reserva RDB, pessoal/família) com auto-categorização + fila de revisão
-- para o que for novo/ambíguo.
--
-- Reaproveita cashflow_entries (já tinha `escopo` empresa/pessoal e
-- categorias como `salario_conjuge`/`correspondente` desenhadas para
-- exatamente esse cenário de finanças pessoais misturadas com o
-- escritório) em vez de criar uma tabela de lançamentos paralela.
--
-- is_transferencia_interna: marca RDB (Aplicação/Resgate) e outras
-- transferências que só trocam de bolso dentro da própria conta — ficam
-- de fora dos totais de entrada/saída real (aqui e em getMonthlyCashflow),
-- mas aparecem num bloco "Reserva RDB" à parte.
--
-- bank_ref: o "Identificador" (UUID) que o Nubank já gera por transação
-- no CSV — usado como chave de dedup; reenviar o mesmo extrato não
-- duplica nada. NULL para lançamentos manuais antigos (permitido,
-- múltiplos NULL convivem sob o índice único).
--
-- review_status: uma linha "pendente" já é um lançamento real (o dinheiro
-- já se moveu) — só falta confirmar a categoria certa. Por isso fica
-- direto em cashflow_entries, não numa tabela de pendências à parte.
-- ============================================================

ALTER TABLE cashflow_entries
  ADD COLUMN bank_ref VARCHAR(64) NULL COMMENT 'Identificador (UUID) do CSV Nubank — chave de dedup',
  ADD COLUMN counterparty VARCHAR(200) NULL COMMENT 'Nome/razão social extraído da Descrição do extrato',
  ADD COLUMN is_transferencia_interna TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'RDB e outras transferências internas: fora de entrada/saída real, mostrado em bloco separado',
  ADD COLUMN origin VARCHAR(20) NOT NULL DEFAULT 'manual' COMMENT 'manual | extrato_nubank',
  ADD COLUMN review_status VARCHAR(12) NOT NULL DEFAULT 'ok' COMMENT 'ok | pendente',
  ADD UNIQUE INDEX uq_cf_bank_ref (bank_ref),
  ADD INDEX idx_cf_counterparty (counterparty),
  ADD INDEX idx_cf_origin_review (origin, review_status);

-- Regras de categorização automática aprendidas por contraparte. Uma linha
-- por (contraparte, categoria) — não um array numa linha só — porque uma
-- mesma contraparte pode legitimamente ter mais de um motivo no extrato
-- (ex.: "Jessica Caroline Rodrigues Cardoso" apareceu num mês com repasse
-- do cônjuge, passagem de terceiro e compra de iPhone). 2+ linhas para o
-- mesmo match_value = ambíguo: o import não adivinha, manda pra revisão
-- com as opções já sugeridas.
CREATE TABLE IF NOT EXISTS bank_statement_rules (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  match_type   VARCHAR(12)   NOT NULL DEFAULT 'counterparty' COMMENT 'counterparty | contains',
  match_value  VARCHAR(200)  NOT NULL,
  type         ENUM('entrada','saida') NOT NULL,
  category     VARCHAR(40)   NOT NULL,
  escopo       VARCHAR(12)   NOT NULL DEFAULT 'empresa',
  is_transferencia_interna TINYINT(1) NOT NULL DEFAULT 0,
  label_override VARCHAR(200) NULL,
  active       TINYINT(1)    NOT NULL DEFAULT 1,
  created_by   INT UNSIGNED  NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE INDEX uq_rule (match_type, match_value, type, category, escopo),
  INDEX idx_rule_match (match_type, match_value, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Histórico de cada upload mensal — responde "já subi o extrato desse mês?"
-- e quantas linhas entraram/já existiam/ficaram pendentes sem reprocessar
-- o CSV inteiro de novo.
CREATE TABLE IF NOT EXISTS bank_statement_imports (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  filename        VARCHAR(255) NULL,
  ref_month       CHAR(7)      NOT NULL COMMENT 'YYYY-MM (mês predominante no CSV)',
  total_rows      INT UNSIGNED NOT NULL DEFAULT 0,
  imported_rows   INT UNSIGNED NOT NULL DEFAULT 0,
  duplicate_rows  INT UNSIGNED NOT NULL DEFAULT 0,
  pending_rows    INT UNSIGNED NOT NULL DEFAULT 0,
  created_by      INT UNSIGNED NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bsi_month (ref_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed de regras — só o que é recorrente e sem ambiguidade (categorizado
-- manualmente com a Dra. Letícia no fechamento de agosto/2026). Nomes com
-- mais de um motivo no mês, ou pagamento de caso único, ficam de fora de
-- propósito: continuam manuais até ela mesma confirmar e marcar
-- "salvar como regra" na revisão.
INSERT INTO bank_statement_rules (match_type, match_value, type, category, escopo, is_transferencia_interna, label_override) VALUES
  ('contains',    'RDB',                                          'saida',   'outro_saida',     'empresa', 1, 'Aplicação RDB (reserva)'),
  ('contains',    'RDB',                                          'entrada', 'outro_entrada',   'empresa', 1, 'Resgate RDB (reserva)'),
  ('contains',    'TECGOLD SISTEMAS EIRELI',                      'saida',   'pessoal',         'pessoal', 0, 'Estacionamento rotativo'),
  ('contains',    'Pagamento de fatura',                          'saida',   'cartao',          'empresa', 0, 'Fatura de cartão'),
  ('contains',    'TELEFONICA',                                   'saida',   'pessoal',          'pessoal', 0, 'Conta de telefone'),
  ('counterparty','Dione Assis Sociedade Individual de Advocacia','entrada', 'correspondente',   'empresa', 0, NULL),
  ('counterparty','Gabriel Peixoto Rocha',                        'entrada', 'correspondente',   'empresa', 0, NULL),
  ('counterparty','Khalleb Teles Cavalcante',                     'entrada', 'correspondente',   'empresa', 0, NULL),
  ('counterparty','Rychard Oliveira Santos',                      'entrada', 'correspondente',   'empresa', 0, NULL),
  ('counterparty','Jessica Rodrigues Gon',                        'entrada', 'correspondente',   'empresa', 0, NULL),
  ('counterparty','Gabriel Caldas Ferreira',                      'entrada', 'correspondente',   'empresa', 0, NULL),
  ('counterparty','Infinity Law Ltda',                            'entrada', 'correspondente',   'empresa', 0, 'Parceria'),
  ('counterparty','Christiane Gomes Oliveira',                    'entrada', 'honorario_total',  'empresa', 0, 'Pensão alimentícia (mensalidade)'),
  ('counterparty','Daisi Das Neves Fernandes',                    'entrada', 'honorario_total',  'empresa', 0, 'Pensão alimentícia (mensalidade)'),
  ('counterparty','Vinicius Alves Do Nascimento',                 'entrada', 'honorario_total',  'empresa', 0, 'Parcela de contrato'),
  ('contains',    '99 TECNOLOGIA',                                'saida',   'pessoal',          'pessoal', 0, 'Transporte (app)')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;
