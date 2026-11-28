-- ============================================================
-- Migration 192 - Lista de documentos do processo pelo MNI (28/11/2026)
-- Pedido da Jessica: o CRM saber se o prazo foi cumprido lendo o TJES.
-- O movimento do PJe diz so Peticao, sem tipo nem autor. A lista de documentos
-- traz o tipo, a descricao e quem assinou. Guarda so esses dados, NUNCA o
-- conteudo. CPF de quem assinou fica mascarado, e assinado_pelo_login diz se
-- foi o dono do login da consulta (a Dra.).
-- legal_processes.mni_documentos_ate: ate qual peticao (data do tribunal) a
-- lista ja foi lida, para nao consultar de novo.
-- So cria tabela e coluna novas: nenhum dado existente muda.
-- IMPORTANTE: o runner divide por ponto e virgula e remove linhas iniciadas
-- por dois tracos, entao nenhum conteudo abaixo contem esses caracteres.
-- ============================================================

CREATE TABLE IF NOT EXISTS mni_documentos (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  process_id          INT UNSIGNED NOT NULL,
  sistema             VARCHAR(40)  NOT NULL,
  id_documento        VARCHAR(64)  NOT NULL,
  id_vinculado_a      VARCHAR(64)  NULL,
  id_movimento        VARCHAR(64)  NULL,
  data_hora           DATETIME     NULL,
  tipo                VARCHAR(40)  NULL,
  tipo_local          VARCHAR(120) NULL,
  descricao           VARCHAR(500) NULL,
  mimetype            VARCHAR(80)  NULL,
  assinado_pelo_login TINYINT(1)   NOT NULL DEFAULT 0,
  dados_json          TEXT         NULL,
  lido_em             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mni_documento (process_id, sistema, id_documento),
  KEY idx_mni_documentos_processo_data (process_id, data_hora)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE legal_processes
  ADD COLUMN mni_documentos_ate DATETIME NULL;
