-- ============================================================
-- Migration 180 — Ligacao oficial com os tribunais (MNI), pedido da Dra. 17/11/2026
-- mni_credenciais: login da advogada em cada sistema (CPF e senha CRIPTOGRAFADOS
--   pelo utils/crypto, nunca em texto puro). Se o tribunal recusar o login, o
--   sistema desliga a credencial sozinho (ativo = 0) para nao bloquear a senha.
-- mni_avisos: intimacoes pendentes vistas no tribunal, com a data da ciencia
--   automatica (10 dias). Quando somem da lista, foram abertas (resolvido_em).
-- tpu_movimentos: nome por extenso dos codigos de movimento do CNJ (cache).
-- So cria tabelas novas: nenhum dado existente muda.
-- IMPORTANTE: o runner divide por ponto e virgula e remove linhas iniciadas
-- por dois tracos, entao nenhum conteudo abaixo contem esses caracteres.
-- ============================================================

CREATE TABLE IF NOT EXISTS mni_credenciais (
  sistema          VARCHAR(40)  NOT NULL PRIMARY KEY,
  cpf_enc          TEXT         NOT NULL,
  senha_enc        TEXT         NOT NULL,
  ativo            TINYINT(1)   NOT NULL DEFAULT 1,
  ultimo_ok_em     DATETIME     NULL,
  ultimo_erro      VARCHAR(500) NULL,
  ultimo_erro_em   DATETIME     NULL,
  avisos_pendentes INT UNSIGNED NOT NULL DEFAULT 0,
  atualizado_por   INT UNSIGNED NULL,
  criado_em        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mni_avisos (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sistema              VARCHAR(40)  NOT NULL,
  id_aviso             VARCHAR(64)  NOT NULL,
  numero_processo      VARCHAR(25)  NULL,
  process_id           INT UNSIGNED NULL,
  tipo_comunicacao     VARCHAR(20)  NULL,
  orgao_julgador       VARCHAR(255) NULL,
  disponibilizado_em   DATETIME     NULL,
  ciencia_automatica_em DATE        NULL,
  visto_pela_ultima_vez DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolvido_em         DATETIME     NULL,
  criado_em            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mni_aviso (sistema, id_aviso),
  KEY idx_mni_avisos_pendentes (resolvido_em, ciencia_automatica_em),
  KEY idx_mni_avisos_processo (process_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tpu_movimentos (
  codigo     INT UNSIGNED NOT NULL PRIMARY KEY,
  nome       VARCHAR(255) NOT NULL,
  criado_em  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
