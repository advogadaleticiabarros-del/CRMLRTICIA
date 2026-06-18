-- ============================================================
-- Migration 009 — Novo funil de leads + módulo de contratos
-- FullCycle Squad — DBA: Lucas
-- ============================================================

-- 1) Amplia o ENUM para conter valores antigos + novos (transição segura)
ALTER TABLE leads MODIFY COLUMN status
  ENUM('novo','contatado','qualificado','reuniao_marcada','convertido','perdido',
       'triagem','atendimento_inicial','reuniao','proposta','proposta_em_analise','fechada','perdida')
  NOT NULL DEFAULT 'triagem';

-- 2) Mapeia os status antigos para o novo funil
UPDATE leads SET status = CASE status
  WHEN 'novo' THEN 'triagem'
  WHEN 'contatado' THEN 'atendimento_inicial'
  WHEN 'qualificado' THEN 'reuniao'
  WHEN 'reuniao_marcada' THEN 'reuniao'
  WHEN 'convertido' THEN 'fechada'
  WHEN 'perdido' THEN 'perdida'
  ELSE status END;

-- 3) Reduz o ENUM apenas para o novo funil
ALTER TABLE leads MODIFY COLUMN status
  ENUM('triagem','atendimento_inicial','reuniao','proposta','proposta_em_analise','fechada','perdida')
  NOT NULL DEFAULT 'triagem';

-- 4) Marca quando o lead entrou em "proposta em análise" (regra dos 7 dias)
ALTER TABLE leads ADD COLUMN analise_since DATETIME NULL;

-- 5) Módulo de produção de contratos
CREATE TABLE IF NOT EXISTS contracts (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  client_id   INT UNSIGNED NULL,
  lead_id     INT UNSIGNED NULL,
  area        ENUM('trabalhista','gestante','familia','civel','previdenciario','consumidor','outro') NOT NULL DEFAULT 'outro',
  title       VARCHAR(500) NOT NULL,
  content     LONGTEXT     NULL,
  value       DECIMAL(12,2) NULL,
  status      ENUM('rascunho','em_producao','finalizado','assinado','cancelado') NOT NULL DEFAULT 'rascunho',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_contracts_user (user_id),
  INDEX idx_contracts_client (client_id),
  INDEX idx_contracts_lead (lead_id),
  INDEX idx_contracts_status (status),
  CONSTRAINT fk_contracts_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  CONSTRAINT fk_contracts_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  CONSTRAINT fk_contracts_lead   FOREIGN KEY (lead_id)   REFERENCES leads(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
