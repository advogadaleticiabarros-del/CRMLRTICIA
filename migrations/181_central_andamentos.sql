-- ============================================================
-- Migration 181 — Central de andamentos (pedido da Dra., 17/11/2026)
-- process_movements ganha a situacao de leitura da EQUIPE (lida e tratada,
--   com quem e quando). Movimentacoes com mais de 7 dias ja entram como lidas,
--   para a caixa de entrada nao comecar com milhares de itens antigos.
-- acoes_novas_clientes: processos achados no DJEN pelo NOME do cliente que
--   ainda nao estao no CRM (pode ser homonimo: a equipe confirma ou descarta).
-- acoes_novas_buscas: registro de cada varredura (uma por dia basta).
-- audiencias_detectadas: audiencia achada no texto de uma movimentacao e o
--   evento criado na agenda (uma por movimentacao).
-- So acrescenta colunas e tabelas: nenhum dado existente e apagado.
-- IMPORTANTE: o runner divide por ponto e virgula e remove linhas iniciadas
-- por dois tracos, entao nenhum conteudo abaixo contem esses caracteres.
-- ============================================================

ALTER TABLE process_movements
  ADD COLUMN lida_em DATETIME NULL,
  ADD COLUMN lida_por INT UNSIGNED NULL,
  ADD COLUMN tratada_em DATETIME NULL,
  ADD COLUMN tratada_por INT UNSIGNED NULL;

CREATE INDEX idx_pm_lida ON process_movements (lida_em);

CREATE INDEX idx_pm_created ON process_movements (created_at);

UPDATE process_movements SET lida_em = created_at WHERE lida_em IS NULL AND created_at < NOW() - INTERVAL 7 DAY;

CREATE TABLE IF NOT EXISTS acoes_novas_clientes (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_id           INT UNSIGNED NOT NULL,
  numero_processo     VARCHAR(25)  NOT NULL,
  tribunal            VARCHAR(40)  NULL,
  orgao               VARCHAR(255) NULL,
  classe              VARCHAR(255) NULL,
  polo                VARCHAR(10)  NULL,
  tipo_comunicacao    VARCHAR(80)  NULL,
  data_publicacao     DATE         NULL,
  trecho              VARCHAR(600) NULL,
  status              ENUM('pendente','confirmada','descartada') NOT NULL DEFAULT 'pendente',
  process_id          INT UNSIGNED NULL,
  resolvido_por       INT UNSIGNED NULL,
  resolvido_em        DATETIME     NULL,
  criado_em           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_acao_cliente_processo (client_id, numero_processo),
  KEY idx_acoes_novas_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS acoes_novas_buscas (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  executada_em  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  executada_por INT UNSIGNED NULL,
  clientes      INT UNSIGNED NOT NULL DEFAULT 0,
  achados       INT UNSIGNED NOT NULL DEFAULT 0,
  bloqueado     TINYINT(1)   NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audiencias_detectadas (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  movement_id   INT UNSIGNED NOT NULL,
  process_id    INT UNSIGNED NOT NULL,
  inicio        DATETIME     NOT NULL,
  event_id      INT UNSIGNED NULL,
  criado_em     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_audiencia_mov (movement_id),
  KEY idx_audiencia_processo (process_id, inicio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
