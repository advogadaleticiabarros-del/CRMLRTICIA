-- ============================================================
-- Migration 053 — Portal do Cliente 2.0
-- Recado ao cliente, documentos liberados, config do escritório (Pix/WhatsApp)
-- e pagamentos declarados pelo cliente (Pix manual; pronto p/ gateway depois).
-- ============================================================

ALTER TABLE cases
  ADD COLUMN client_message TEXT NULL;

ALTER TABLE documents
  ADD COLUMN visible_to_client TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE installments
  MODIFY COLUMN status ENUM('pendente','pago','vencido','cancelado','em_processamento') NOT NULL DEFAULT 'pendente';

CREATE TABLE IF NOT EXISTS office_settings (
  setting_key   VARCHAR(60) PRIMARY KEY,
  setting_value TEXT NULL,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  installment_id INT UNSIGNED NOT NULL,
  client_id      INT UNSIGNED NOT NULL,
  method         ENUM('pix_manual','mercadopago') NOT NULL DEFAULT 'pix_manual',
  status         ENUM('em_processamento','confirmado','recusado') NOT NULL DEFAULT 'em_processamento',
  amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
  note           VARCHAR(500) NULL,
  provider_txn_id VARCHAR(120) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at   DATETIME NULL,
  confirmed_by   INT UNSIGNED NULL,
  INDEX idx_payments_installment (installment_id),
  INDEX idx_payments_status (status),
  INDEX idx_payments_client (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
