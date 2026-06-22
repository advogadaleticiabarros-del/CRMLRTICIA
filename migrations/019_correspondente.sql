-- ============================================================
-- Migration 019 — Correspondente Jurídico (audiências para outros escritórios)
-- Audiência como advogado ou preposto, com pagador (empresa/CPF) e valor.
-- Atrelado ao financeiro: vira entrada no fluxo de caixa (categoria correspondente).
-- ============================================================

CREATE TABLE IF NOT EXISTS correspondent_hearings (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id           INT UNSIGNED  NULL,
  hearing_datetime  DATETIME      NOT NULL,
  role              ENUM('advogado','preposto') NOT NULL DEFAULT 'advogado',
  process_number    VARCHAR(40)   NULL,
  comarca           VARCHAR(120)  NULL,
  vara              VARCHAR(120)  NULL,
  location          VARCHAR(255)  NULL,           -- fórum / link / endereço
  requesting_office VARCHAR(255)  NULL,           -- escritório/advogado que contratou
  payer_name        VARCHAR(255)  NOT NULL,       -- quem paga (empresa ou pessoa)
  payer_type        ENUM('PJ','PF') NOT NULL DEFAULT 'PJ',
  payer_document    VARCHAR(20)   NULL,           -- CNPJ ou CPF
  value             DECIMAL(14,2) NOT NULL DEFAULT 0,
  status            ENUM('agendada','realizada','faturada','paga','cancelada') NOT NULL DEFAULT 'agendada',
  due_date          DATE          NULL,           -- vencimento do pagamento
  paid_at           DATE          NULL,
  notes             TEXT          NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_corr_date   (hearing_datetime),
  INDEX idx_corr_status (status),
  INDEX idx_corr_due    (due_date),
  INDEX idx_corr_payer  (payer_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
