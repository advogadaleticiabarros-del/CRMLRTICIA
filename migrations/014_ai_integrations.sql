-- ============================================================
-- Migration 014 — IA, Integrações e Áreas Jurídicas
-- Integrado do server-legal-hub (schema.prisma → MySQL)
-- Inclui geração IA, gerenciamento de integrações externas,
-- áreas jurídicas e tipos de caso configuráveis.
-- ============================================================

-- ─────────────────────────────────────────
-- legal_areas — áreas do direito configuráveis
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS legal_areas (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  description TEXT         NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_legal_areas_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- case_types — tipos de caso por área jurídica
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_types (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  legal_area_id       INT UNSIGNED NOT NULL,
  name                VARCHAR(255) NOT NULL,
  description         TEXT         NULL,
  requires_dependents TINYINT(1)   NOT NULL DEFAULT 0,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_case_types_area (legal_area_id),

  CONSTRAINT fk_case_types_area FOREIGN KEY (legal_area_id) REFERENCES legal_areas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- ai_generations — histórico de geração por IA
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_generations (
  id            INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED  NOT NULL,
  type          VARCHAR(30)   NOT NULL,
  -- proposta | contrato | peticao | resumo | email | cobranca
  prompt        LONGTEXT      NOT NULL,
  result        LONGTEXT      NOT NULL,
  status        VARCHAR(20)   NOT NULL DEFAULT 'completed',
  -- pending | completed | failed
  tokens        INT           NULL,
  error_message TEXT          NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_ai_gen_user   (user_id),
  INDEX idx_ai_gen_type   (type),
  INDEX idx_ai_gen_status (status),
  INDEX idx_ai_gen_created (created_at),

  CONSTRAINT fk_ai_gen_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- integrations — integrações externas por usuário
-- (zapsign, trello, google, n8n, asaas, resend, escavador…)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integrations (
  id             INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  user_id        INT UNSIGNED  NOT NULL,
  name           VARCHAR(50)   NOT NULL,
  -- zapsign | trello | google | n8n | asaas | resend | escavador
  is_active      TINYINT(1)    NOT NULL DEFAULT 0,
  test_passed    TINYINT(1)    NOT NULL DEFAULT 0,
  config         TEXT          NOT NULL,
  -- JSON com dados sensíveis (criptografar em aplicação)
  last_tested_at DATETIME      NULL,
  error_message  TEXT          NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_integrations_user_name (user_id, name),
  INDEX idx_integrations_name   (name),
  INDEX idx_integrations_active (is_active),

  CONSTRAINT fk_integrations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- Seed: áreas jurídicas padrão do server-legal-hub
-- ─────────────────────────────────────────
INSERT IGNORE INTO legal_areas (name, description) VALUES
  ('Trabalhista',      'Direito do Trabalho'),
  ('Previdenciário',   'Direito Previdenciário / INSS'),
  ('Família',          'Direito de Família'),
  ('Cível',            'Direito Civil'),
  ('Consumidor',       'Direito do Consumidor'),
  ('Gestante',         'Direitos da Gestante / Licença Maternidade'),
  ('Criminal',         'Direito Criminal'),
  ('Empresarial',      'Direito Empresarial'),
  ('Imobiliário',      'Direito Imobiliário'),
  ('Outro',            NULL);
