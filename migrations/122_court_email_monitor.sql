-- ============================================================
-- Migration 122 — Monitoramento de movimentacao processual por E-MAIL
-- (item 7 do plano) Plano B do monitoramento via DJEN/DataJud
-- (monitoringService.ts): muitos tribunais tambem notificam
-- movimentacao processual direto por e-mail (PJe etc). Esta tabela
-- guarda a conexao OAuth com a caixa de e-mail que a advogada
-- decidir conectar (ela escolhe QUAL conta na hora - o sistema nao
-- assume nenhum endereco). E DELIBERADAMENTE separada tanto de
-- email_integration (Gmail do PARCEIRO, outra finalidade: captar
-- indicacao de cliente) quanto de google_accounts (Agenda, por
-- usuario) para nao misturar escopos OAuth de proposito diferente
-- numa mesma credencial - cada conexao pede so o escopo que precisa.
-- Linha unica (id=1), no mesmo padrao de email_integration: e uma
-- caixa de e-mail do ESCRITORIO, nao por usuario.
-- court_email_messages e so o log/dedupe do QUE JA FOI VARRIDO no
-- Gmail (idempotencia do scan) - a movimentacao em si, quando
-- confirmada, entra em process_movements (fonte = email_monitoramento),
-- a MESMA tabela usada pelo DJEN. Nao duplica o pipeline de
-- movimentacao, so alimenta a mesma tabela por outra fonte.
-- IMPORTANTE: o runner remove linhas iniciadas por '--' e divide por
-- ';'. Nenhum statement abaixo contem ';' interno.
-- ============================================================

CREATE TABLE IF NOT EXISTS court_email_integration (
  id               INT UNSIGNED PRIMARY KEY,
  google_email     VARCHAR(255) NULL,
  access_token     TEXT         NULL,
  refresh_token    TEXT         NULL,
  token_expiry     DATETIME     NULL,
  active           TINYINT(1)   NOT NULL DEFAULT 1,
  last_check_at    DATETIME     NULL,
  last_check_found INT UNSIGNED NOT NULL DEFAULT 0,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS court_email_messages (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  gmail_message_id   VARCHAR(120) NOT NULL,
  from_email         VARCHAR(255) NULL,
  subject            VARCHAR(500) NULL,
  process_number     VARCHAR(40)  NULL,
  process_id         INT UNSIGNED NULL,
  status             ENUM('sem_processo_identificado','ja_capturado_djen','movimentacao_registrada','ignorado','erro') NOT NULL,
  detail             VARCHAR(500) NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cem_message (gmail_message_id),
  INDEX idx_cem_process (process_id),
  CONSTRAINT fk_cem_process FOREIGN KEY (process_id) REFERENCES legal_processes(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
