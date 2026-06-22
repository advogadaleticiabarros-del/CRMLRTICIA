-- ============================================================
-- Migration 016 — Fluxo de Caixa (lançamentos manuais + recorrência)
-- A visão consolidada lê desta tabela + das fontes já existentes
-- (parcelas, installments, dativo, acordos, repasses, financial_records).
-- Lançamentos recorrentes são expandidos em 1 linha por mês (group).
-- ============================================================

CREATE TABLE IF NOT EXISTS cashflow_entries (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id           INT UNSIGNED NULL,
  type              ENUM('entrada','saida') NOT NULL,
  category          VARCHAR(40)   NOT NULL,
  -- entrada: honorario_inicial | honorario_total | exito | acordo | dativo | correspondente | outro_entrada
  -- saida:   despesa_fixa | despesa_variavel | repasse | imposto | salario | outro_saida
  description       VARCHAR(500)  NOT NULL,
  amount            DECIMAL(14,2) NOT NULL DEFAULT 0,
  due_date          DATE          NOT NULL,
  status            ENUM('previsto','realizado') NOT NULL DEFAULT 'previsto',
  paid_at           DATE          NULL,
  client_id         INT UNSIGNED  NULL,
  case_id           INT UNSIGNED  NULL,
  cost_center       VARCHAR(100)  NULL,
  recurrence_group  CHAR(36)      NULL,   -- liga as parcelas de um lançamento recorrente
  installment_no    INT           NULL,
  installment_total INT           NULL,
  notes             TEXT          NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_cf_due    (due_date),
  INDEX idx_cf_type   (type),
  INDEX idx_cf_cat    (category),
  INDEX idx_cf_status (status),
  INDEX idx_cf_group  (recurrence_group),

  CONSTRAINT fk_cf_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  CONSTRAINT fk_cf_case   FOREIGN KEY (case_id)   REFERENCES cases(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
