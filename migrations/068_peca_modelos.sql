-- Migration 068 — Biblioteca de modelos de peças (alimenta a IA que gera petições)
CREATE TABLE IF NOT EXISTS peca_modelos (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  external_key  VARCHAR(255) NOT NULL,           -- slug/arquivo de origem, p/ upsert idempotente
  titulo        VARCHAR(255) NOT NULL,
  area          VARCHAR(60)  NULL,
  assunto       VARCHAR(255) NULL,
  tipo          VARCHAR(60)  NULL,
  rito          VARCHAR(120) NULL,
  tribunal      VARCHAR(60)  NULL,
  teses         TEXT         NULL,                -- lista separada por ponto-e-virgula
  fundamentos   TEXT         NULL,
  conteudo      LONGTEXT     NULL,                -- texto completo da peça (extraído do .docx)
  fonte         VARCHAR(30)  NOT NULL DEFAULT 'obsidian',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_peca_modelos_key (external_key)
);
