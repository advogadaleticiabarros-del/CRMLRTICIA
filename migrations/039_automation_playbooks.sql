-- ============================================================
-- Migration 039 — Motor de automação (playbooks)
-- Regras prontas, cada uma ligável/desligável. A base já fica pronta para,
-- no futuro, receber regras personalizadas (no-code) — daí o campo config JSON
-- e o trigger_type genérico.
-- ============================================================

CREATE TABLE IF NOT EXISTS automation_rules (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  rule_key     VARCHAR(60)  NOT NULL,
  name         VARCHAR(160) NOT NULL,
  description  VARCHAR(500) NULL,
  trigger_type VARCHAR(60)  NOT NULL,
  enabled      TINYINT(1)   NOT NULL DEFAULT 1,
  config       JSON         NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_automation_key (rule_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automation_runs (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  rule_key    VARCHAR(60)  NOT NULL,
  trigger_ref VARCHAR(120) NULL,
  status      VARCHAR(20)  NOT NULL DEFAULT 'ok',
  message     VARCHAR(500) NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ar_key (rule_key),
  INDEX idx_ar_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO automation_rules (rule_key, name, description, trigger_type, enabled) VALUES
  ('estagiario_intimacao', 'Estagiário IA: análise + minuta na intimação', 'Ao detectar uma intimação (DJEN), gera automaticamente a análise (resumo, prazo, próxima ação, risco) e a minuta da peça para revisão.', 'intimacao_detectada', 1),
  ('intimacao_telegram', 'Avisar no Telegram quando chega intimação', 'Envia um resumo da intimação detectada por Telegram aos administradores com Telegram configurado.', 'intimacao_detectada', 0),
  ('prazo_confirmado_sem_caso', 'Tarefa para vincular processo sem caso', 'Ao confirmar um prazo cujo processo ainda não tem caso vinculado, cria uma tarefa para fazer o vínculo (entra nos alertas de prazo).', 'prazo_confirmado', 1);
