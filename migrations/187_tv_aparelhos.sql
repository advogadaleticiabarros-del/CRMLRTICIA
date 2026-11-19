-- ============================================================
-- Migration 187 — TVs do escritorio liberadas por codigo, 19/11/2026
-- A TV mostra um codigo de 6 numeros e alguem da equipe libera pelo celular.
-- Guarda so o hash (sha256) do segredo que a TV usa. Tabela nova: nada existente muda.
-- IMPORTANTE: o runner divide por ponto e virgula e remove linhas iniciadas
-- por dois tracos, entao nenhum conteudo abaixo contem esses caracteres.
-- ============================================================

CREATE TABLE IF NOT EXISTS tv_aparelhos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  codigo CHAR(6) NULL,
  segredo_hash CHAR(64) NOT NULL,
  status ENUM('aguardando','liberada','revogada') NOT NULL DEFAULT 'aguardando',
  nome VARCHAR(80) NULL,
  liberada_por INT NULL,
  liberada_em DATETIME NULL,
  ultimo_uso DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tv_segredo (segredo_hash),
  KEY idx_tv_codigo (codigo, status),
  KEY idx_tv_criado (created_at)
)
