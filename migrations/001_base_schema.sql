-- ============================================================
-- Migration 001 — Schema Base do CRM Jurídico
-- FullCycle Squad — DBA: Lucas
-- Roda ANTES da 002 (calendar/notifications) — ordem alfabética garante isso.
-- ============================================================

-- ─────────────────────────────────────────
-- users — usuários do escritório (advogados, staff)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  email       VARCHAR(255) NOT NULL,
  password    VARCHAR(255) NOT NULL,
  role        ENUM('admin','advogado','staff') NOT NULL DEFAULT 'advogado',
  active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- clients — clientes do escritório (PF e PJ)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  tipo          ENUM('PF','PJ') NOT NULL DEFAULT 'PF',
  cpf_cnpj      VARCHAR(20)  NULL,
  email         VARCHAR(255) NULL,
  phone         VARCHAR(30)  NULL,
  address       VARCHAR(500) NULL,
  notes         TEXT         NULL,
  status        ENUM('ativo','inativo','prospecto') NOT NULL DEFAULT 'ativo',
  created_by    INT UNSIGNED NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_clients_name (name),
  INDEX idx_clients_cpf_cnpj (cpf_cnpj),
  INDEX idx_clients_created_by (created_by),
  CONSTRAINT fk_clients_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- leads — potenciais clientes (funil comercial)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  client_id   INT UNSIGNED NULL,
  name        VARCHAR(255) NOT NULL,
  email       VARCHAR(255) NULL,
  phone       VARCHAR(30)  NULL,
  source      VARCHAR(100) NULL,
  legal_area  VARCHAR(100) NULL,
  status      ENUM('novo','contatado','qualificado','reuniao_marcada','convertido','perdido') NOT NULL DEFAULT 'novo',
  notes       TEXT         NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_leads_user (user_id),
  INDEX idx_leads_status (status),
  INDEX idx_leads_created (created_at),
  CONSTRAINT fk_leads_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  CONSTRAINT fk_leads_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- cases — casos / processos
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cases (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      INT UNSIGNED NOT NULL,
  client_id    INT UNSIGNED NOT NULL,
  case_number  VARCHAR(50)  NULL,
  title        VARCHAR(500) NOT NULL,
  legal_area   ENUM('trabalhista','gestante','familia','civel','previdenciario','consumidor','outro') NOT NULL DEFAULT 'outro',
  phase        ENUM('inicial','instrucao','sentenca','recurso','execucao','encerrado') NOT NULL DEFAULT 'inicial',
  status       ENUM('ativo','suspenso','encerrado') NOT NULL DEFAULT 'ativo',
  description  TEXT         NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cases_user (user_id),
  INDEX idx_cases_client (client_id),
  INDEX idx_cases_status (status),
  INDEX idx_cases_area (legal_area),
  INDEX idx_cases_phase (phase),
  INDEX idx_cases_number (case_number),
  CONSTRAINT fk_cases_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  CONSTRAINT fk_cases_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- case_movements — movimentações processuais
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_movements (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id      INT UNSIGNED NOT NULL,
  client_id    INT UNSIGNED NOT NULL,
  description  TEXT         NOT NULL,
  movement_date DATETIME    NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_movements_case (case_id),
  INDEX idx_movements_client (client_id),
  INDEX idx_movements_created (created_at),
  CONSTRAINT fk_movements_case   FOREIGN KEY (case_id)   REFERENCES cases(id)   ON DELETE CASCADE,
  CONSTRAINT fk_movements_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- propostas — propostas de honorários
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS propostas (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  client_id   INT UNSIGNED NOT NULL,
  case_id     INT UNSIGNED NULL,
  lead_id     INT UNSIGNED NULL,
  title       VARCHAR(500) NOT NULL,
  valor       DECIMAL(12,2) NOT NULL DEFAULT 0,
  status      ENUM('rascunho','enviada','em_negociacao','aceita','recusada') NOT NULL DEFAULT 'rascunho',
  validade    DATE         NULL,
  description TEXT         NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_propostas_user (user_id),
  INDEX idx_propostas_client (client_id),
  INDEX idx_propostas_status (status),
  INDEX idx_propostas_validade (validade),
  CONSTRAINT fk_propostas_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  CONSTRAINT fk_propostas_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT fk_propostas_case   FOREIGN KEY (case_id)   REFERENCES cases(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- tasks — tarefas
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  client_id   INT UNSIGNED NULL,
  case_id     INT UNSIGNED NULL,
  title       VARCHAR(500) NOT NULL,
  description TEXT         NULL,
  due_date    DATETIME     NULL,
  priority    ENUM('baixa','media','alta','critica') NOT NULL DEFAULT 'media',
  status      ENUM('pendente','em_andamento','concluida','cancelada') NOT NULL DEFAULT 'pendente',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tasks_user (user_id),
  INDEX idx_tasks_client (client_id),
  INDEX idx_tasks_status (status),
  INDEX idx_tasks_due (due_date),
  INDEX idx_tasks_priority (priority),
  CONSTRAINT fk_tasks_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  CONSTRAINT fk_tasks_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  CONSTRAINT fk_tasks_case   FOREIGN KEY (case_id)   REFERENCES cases(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- deadlines — prazos processuais
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deadlines (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL,
  client_id     INT UNSIGNED NULL,
  case_id       INT UNSIGNED NOT NULL,
  description   VARCHAR(500) NOT NULL,
  deadline_date DATETIME     NOT NULL,
  priority      ENUM('baixa','media','alta','critica') NOT NULL DEFAULT 'alta',
  status        ENUM('pendente','cumprido','cancelado') NOT NULL DEFAULT 'pendente',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_deadlines_user (user_id),
  INDEX idx_deadlines_client (client_id),
  INDEX idx_deadlines_case (case_id),
  INDEX idx_deadlines_status (status),
  INDEX idx_deadlines_date (deadline_date),
  CONSTRAINT fk_deadlines_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  CONSTRAINT fk_deadlines_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  CONSTRAINT fk_deadlines_case   FOREIGN KEY (case_id)   REFERENCES cases(id)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- documents — documentos do cliente / caso
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id   INT UNSIGNED NOT NULL,
  case_id     INT UNSIGNED NULL,
  name        VARCHAR(500) NOT NULL,
  type        VARCHAR(100) NULL,
  file_path   VARCHAR(1000) NULL,
  status      ENUM('pendente','recebido','assinado','arquivado') NOT NULL DEFAULT 'pendente',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_documents_client (client_id),
  INDEX idx_documents_case (case_id),
  INDEX idx_documents_status (status),
  CONSTRAINT fk_documents_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT fk_documents_case   FOREIGN KEY (case_id)   REFERENCES cases(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- installments — parcelas (recebimentos do cliente)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS installments (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id     INT UNSIGNED NOT NULL,
  proposta_id   INT UNSIGNED NULL,
  case_id       INT UNSIGNED NULL,
  numero        INT          NULL,
  valor         DECIMAL(12,2) NOT NULL DEFAULT 0,
  due_date      DATE         NOT NULL,
  paid_at       DATETIME     NULL,
  status        ENUM('pendente','pago','vencido','cancelado') NOT NULL DEFAULT 'pendente',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_installments_client (client_id),
  INDEX idx_installments_status (status),
  INDEX idx_installments_due (due_date),
  CONSTRAINT fk_installments_client   FOREIGN KEY (client_id)   REFERENCES clients(id)   ON DELETE CASCADE,
  CONSTRAINT fk_installments_proposta FOREIGN KEY (proposta_id) REFERENCES propostas(id) ON DELETE SET NULL,
  CONSTRAINT fk_installments_case     FOREIGN KEY (case_id)     REFERENCES cases(id)     ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- financial_records — registros financeiros (receitas e despesas)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS financial_records (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         INT UNSIGNED NOT NULL,
  client_id       INT UNSIGNED NULL,
  case_id         INT UNSIGNED NULL,
  tipo            ENUM('receita','despesa') NOT NULL,
  description     VARCHAR(500) NOT NULL,
  valor           DECIMAL(12,2) NOT NULL DEFAULT 0,
  status          ENUM('pendente','pago','vencido','cancelado') NOT NULL DEFAULT 'pendente',
  due_date        DATE         NULL,
  paid_at         DATETIME     NULL,
  cost_center     VARCHAR(100) NULL,
  recurrence_type ENUM('mensal','trimestral','semestral','anual') NULL,
  next_due_date   DATE         NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_financial_user (user_id),
  INDEX idx_financial_client (client_id),
  INDEX idx_financial_case (case_id),
  INDEX idx_financial_tipo (tipo),
  INDEX idx_financial_status (status),
  INDEX idx_financial_due (due_date),
  INDEX idx_financial_cost_center (cost_center),
  CONSTRAINT fk_financial_user   FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  CONSTRAINT fk_financial_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  CONSTRAINT fk_financial_case   FOREIGN KEY (case_id)   REFERENCES cases(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- legal_pieces — peças jurídicas (produção)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS legal_pieces (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  case_id     INT UNSIGNED NULL,
  task_id     INT UNSIGNED NULL,
  title       VARCHAR(500) NOT NULL,
  type        VARCHAR(100) NULL,
  status      ENUM('rascunho','producao','revisao','finalizado','protocolado','cancelado') NOT NULL DEFAULT 'rascunho',
  due_date    DATETIME     NULL,
  content     LONGTEXT     NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pieces_user (user_id),
  INDEX idx_pieces_case (case_id),
  INDEX idx_pieces_task (task_id),
  INDEX idx_pieces_status (status),
  INDEX idx_pieces_due (due_date),
  CONSTRAINT fk_pieces_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_pieces_case FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE SET NULL,
  CONSTRAINT fk_pieces_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
