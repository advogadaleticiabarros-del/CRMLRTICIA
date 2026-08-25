-- Migration 100 — Padroniza legal_area em propostas e leads
-- Mesma lista de 7 valores que cases.legal_area já usa (migrations/001_base_schema.sql).
-- Nem todo caminho de entrada garante esses 7 valores — o formulário público
-- do site (src/routes/lead-public.ts) grava leads sem passar por nenhum
-- <select> do CRM. Por isso, antes de converter a coluna pra ENUM, os UPDATEs
-- abaixo zeram qualquer legal_area fora da lista: é esse UPDATE de limpeza,
-- não o frontend, que garante que só os 7 valores sobrevivem à conversão.
-- Em sql_mode estrito (padrão do MySQL 5.7+/8.0), um ALTER MODIFY COLUMN pra
-- ENUM com linha fora da lista aborta com erro — sem o UPDATE antes, o ALTER
-- de propostas poderia passar (commit implícito de DDL) enquanto o de leads
-- falhasse, deixando a migration pela metade.

UPDATE propostas SET legal_area = NULL
  WHERE legal_area IS NOT NULL
    AND legal_area NOT IN ('trabalhista','gestante','familia','civel','previdenciario','consumidor','outro');

UPDATE leads SET legal_area = NULL
  WHERE legal_area IS NOT NULL
    AND legal_area NOT IN ('trabalhista','gestante','familia','civel','previdenciario','consumidor','outro');

ALTER TABLE propostas
  MODIFY COLUMN legal_area ENUM('trabalhista','gestante','familia','civel','previdenciario','consumidor','outro') NULL;

ALTER TABLE leads
  MODIFY COLUMN legal_area ENUM('trabalhista','gestante','familia','civel','previdenciario','consumidor','outro') NULL;
