-- ============================================================
-- Migration 010 — Fluxo de produção: contrato (3 docs) → assinatura →
-- caso → esteira de produção → protocolo → histórico do cliente
-- FullCycle Squad — DBA: Lucas
-- ============================================================

-- 1) Contrato: status de assinatura + documentos companheiros
ALTER TABLE contracts
  MODIFY COLUMN status ENUM('rascunho','em_producao','finalizado','enviado_assinatura','assinado','cancelado') NOT NULL DEFAULT 'rascunho',
  ADD COLUMN procuracao_content LONGTEXT NULL,
  ADD COLUMN declaracao_content LONGTEXT NULL;

-- 2) Caso: esteira de produção + origem (contrato)
ALTER TABLE cases
  ADD COLUMN production_stage ENUM('separacao_documentos','criacao_inicial','revisao_inicial','aguardando_protocolo','protocolado','concluido') NULL,
  ADD COLUMN origin_contract_id INT UNSIGNED NULL,
  ADD INDEX idx_cases_prod_stage (production_stage);

-- 3) Histórico/linha do tempo do cliente
CREATE TABLE IF NOT EXISTS client_timeline (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id   INT UNSIGNED NOT NULL,
  case_id     INT UNSIGNED NULL,
  contract_id INT UNSIGNED NULL,
  event_type  VARCHAR(60)  NOT NULL,
  description VARCHAR(500) NOT NULL,
  created_by  INT UNSIGNED NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_timeline_client (client_id),
  INDEX idx_timeline_created (created_at),
  CONSTRAINT fk_timeline_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
