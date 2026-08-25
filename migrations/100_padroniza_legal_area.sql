-- Migration 100 — Padroniza legal_area em propostas e leads
-- Mesma lista de 7 valores que cases.legal_area já usa (migrations/001_base_schema.sql).
-- O frontend (propostaForm, leadForm) já só permite esses valores via <select> —
-- esta migration alinha o schema do banco com o que a UI já garante. Valores
-- antigos gravados fora da lista (ex: por importação direta na API, sem passar
-- pelo formulário) viram NULL na conversão — não é migração de dados, é
-- padronização de schema (decisão explícita: não reescrever dado antigo).

ALTER TABLE propostas
  MODIFY COLUMN legal_area ENUM('trabalhista','gestante','familia','civel','previdenciario','consumidor','outro') NULL;

ALTER TABLE leads
  MODIFY COLUMN legal_area ENUM('trabalhista','gestante','familia','civel','previdenciario','consumidor','outro') NULL;
