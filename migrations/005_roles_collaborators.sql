-- ============================================================
-- Migration 005 — Papéis de usuário, repasse de parceiros e colaboradores
-- FullCycle Squad — DBA: Lucas
-- ============================================================

-- Expande os papéis e adiciona comissão (parceiro) e vínculo a cliente (portal)
ALTER TABLE users
  MODIFY COLUMN role ENUM('admin','advogado','estagiario','parceiro','cliente','staff') NOT NULL DEFAULT 'advogado',
  ADD COLUMN commission_percent INT NULL,
  ADD COLUMN client_id INT UNSIGNED NULL,
  ADD INDEX idx_users_client (client_id),
  ADD CONSTRAINT fk_users_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

-- Quem trabalha em cada processo (estagiários e parceiros) + repasse daquele caso
CREATE TABLE IF NOT EXISTS case_collaborators (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id            INT UNSIGNED NOT NULL,
  user_id            INT UNSIGNED NOT NULL,
  role               ENUM('responsavel','colaborador') NOT NULL DEFAULT 'colaborador',
  commission_percent INT          NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_case_collab (case_id, user_id),
  INDEX idx_collab_case (case_id),
  INDEX idx_collab_user (user_id),
  CONSTRAINT fk_collab_case FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_collab_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
