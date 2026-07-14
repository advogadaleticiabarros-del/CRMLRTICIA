-- Migration 070 — Registro de expurgo (LGPD art. 15/16)
-- A LGPD exige eliminar dado pessoal quando acaba a finalidade. Mas o escritório
-- também precisa PROVAR que cumpre — por isso todo expurgo fica registrado aqui.
CREATE TABLE IF NOT EXISTS retention_log (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  politica    VARCHAR(60)  NOT NULL,   -- ex.: 'password_resets_expirados'
  tabela      VARCHAR(60)  NOT NULL,
  acao        ENUM('apagado','anonimizado') NOT NULL,
  linhas      INT          NOT NULL DEFAULT 0,
  criterio    VARCHAR(255) NULL,       -- ex.: 'usados/expirados há mais de 7 dias'
  simulacao   TINYINT(1)   NOT NULL DEFAULT 0,  -- 1 = dry-run (não apagou)
  ran_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_retention_log_data (ran_at)
);
