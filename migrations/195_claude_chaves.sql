-- ============================================================
-- Migration 195 - Chaves de acesso do Claude (28/11/2026)
-- Extensao do CRM para o Claude Desktop dos advogados: cada pessoa gera a sua
-- chave no CRM, cola na extensao e o Claude consulta o CRM em nome dela, com
-- as mesmas permissoes. Guarda so o hash (sha256) da chave; o prefixo serve
-- para a pessoa reconhecer qual e qual na lista. Revogar desliga na hora.
-- Tabela nova: nada existente muda.
-- IMPORTANTE: o runner divide por ponto e virgula e remove linhas iniciadas
-- por dois tracos, entao nenhum conteudo abaixo contem esses caracteres.
-- ============================================================

CREATE TABLE IF NOT EXISTS claude_chaves (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  nome          VARCHAR(80) NOT NULL,
  prefixo       VARCHAR(16) NOT NULL,
  segredo_hash  CHAR(64) NOT NULL,
  criada_em     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_uso    DATETIME NULL,
  usos          INT UNSIGNED NOT NULL DEFAULT 0,
  revogada_em   DATETIME NULL,
  UNIQUE KEY uq_claude_chave_hash (segredo_hash),
  KEY idx_claude_chaves_user (user_id, revogada_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
