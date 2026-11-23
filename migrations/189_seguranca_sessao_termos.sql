-- ============================================================
-- Migration 189 — Padrão de segurança (23/11/2026).
-- users.token_version: versão da sessão; subir derruba todos os logins do
--   usuário (troca/redefinição de senha, desativação, mudança de papel).
-- users.termos_versao / termos_aceitos_em: última versão dos Termos de Uso e
--   da Política de Privacidade aceita.
-- termos_aceites: prova de cada aceite (quem, versão, quando, IP, navegador) — LGPD.
-- Só acrescenta; nenhum dado existente muda. Sessões abertas seguem válidas
-- (token sem versão = versão 0).
-- ============================================================

ALTER TABLE users
  ADD COLUMN token_version INT NOT NULL DEFAULT 0,
  ADD COLUMN termos_versao VARCHAR(20) NULL,
  ADD COLUMN termos_aceitos_em DATETIME NULL;

CREATE TABLE IF NOT EXISTS termos_aceites (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT          NOT NULL,
  versao      VARCHAR(20)  NOT NULL,
  aceito_em   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip          VARCHAR(64)  NULL,
  navegador   VARCHAR(255) NULL,
  INDEX idx_termos_aceites_user (user_id, versao)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
