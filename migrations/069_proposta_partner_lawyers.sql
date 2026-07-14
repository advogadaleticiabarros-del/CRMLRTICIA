-- Migration 069 - Advogados parceiros na proposta publica
-- Campo livre para exibir "Em parceria com ..." quando houver atuacao conjunta.
-- Idempotente: evita falha se a coluna foi criada em tentativa anterior de deploy.

SET @partner_lawyers_exists := (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'propostas'
     AND COLUMN_NAME = 'partner_lawyers'
);

SET @partner_lawyers_sql := IF(
  @partner_lawyers_exists = 0,
  'ALTER TABLE propostas ADD COLUMN partner_lawyers TEXT NULL',
  'SELECT 1'
);

PREPARE partner_lawyers_stmt FROM @partner_lawyers_sql;
EXECUTE partner_lawyers_stmt;
DEALLOCATE PREPARE partner_lawyers_stmt;
