-- ============================================================
-- Migration 003 — Primeiro Atendimento (intakes)
-- FullCycle Squad — DBA: Lucas
-- Porta de entrada: registra o contato inicial e a triagem do caso.
-- ============================================================

CREATE TABLE IF NOT EXISTS intakes (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL,
  client_id     INT UNSIGNED NULL,
  lead_id       INT UNSIGNED NULL,
  contact_name  VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NULL,
  phone         VARCHAR(30)  NULL,
  legal_area    ENUM('trabalhista','gestante','familia','civel','previdenciario','consumidor','outro') NOT NULL DEFAULT 'outro',
  source        ENUM('telefone','whatsapp','site','indicacao','instagram','google','presencial','outro') NOT NULL DEFAULT 'outro',
  report        TEXT         NULL,
  urgency       ENUM('baixa','media','alta') NOT NULL DEFAULT 'media',
  potential     ENUM('alto','medio','baixo') NULL,
  status        ENUM('novo','em_triagem','qualificado','convertido','descartado') NOT NULL DEFAULT 'novo',
  notes         TEXT         NULL,
  intake_date   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_intakes_user (user_id),
  INDEX idx_intakes_client (client_id),
  INDEX idx_intakes_lead (lead_id),
  INDEX idx_intakes_status (status),
  INDEX idx_intakes_area (legal_area),
  INDEX idx_intakes_date (intake_date),
  CONSTRAINT fk_intakes_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  CONSTRAINT fk_intakes_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  CONSTRAINT fk_intakes_lead   FOREIGN KEY (lead_id)   REFERENCES leads(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
