-- ============================================================
-- Migration 109 — Detecção automática de nomeação dativa
-- Quando o monitoramento (DJEN/OAB) traz uma publicação que é uma
-- decisão nomeando a advogada como defensora dativa, o sistema já
-- cria a demanda em dative_cases sozinho (sem digitação manual).
-- Colunas novas guardam o que a IA extrai do teor da publicação —
-- reaproveitadas depois para pré-preencher o gerador do Aceite de
-- Nomeação Dativa (juízo, Id da decisão, qualificação da parte).
-- origem marca se a demanda foi criada manualmente ou pela detecção
-- automática, e legal_process_id liga de volta ao processo
-- monitorado (evita cadastrar a mesma nomeação duas vezes).
-- IMPORTANTE: o runner divide por ';' e remove linhas iniciadas por '--',
-- entao nenhum conteudo abaixo contem ';' nem linha comecando com '--'.
-- ============================================================

ALTER TABLE dative_cases
  ADD COLUMN juizo VARCHAR(255) NULL AFTER vara,
  ADD COLUMN decisao_id VARCHAR(60) NULL AFTER assunto,
  ADD COLUMN qualificacao_parte VARCHAR(80) NULL AFTER decisao_id,
  ADD COLUMN legal_process_id INT UNSIGNED NULL AFTER case_id,
  ADD COLUMN origem ENUM('manual','auto_djen') NOT NULL DEFAULT 'manual' AFTER status,
  ADD INDEX idx_dative_cases_legal_process (legal_process_id),
  ADD INDEX idx_dative_cases_process_number (process_number),
  ADD CONSTRAINT fk_dative_cases_legal_process FOREIGN KEY (legal_process_id) REFERENCES legal_processes(id) ON DELETE SET NULL
