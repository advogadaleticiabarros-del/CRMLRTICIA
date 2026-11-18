-- ============================================================
-- Migration 183 — Dados do processo vindos do tribunal (MNI), 18/11/2026
-- legal_processes: valor da causa e lista das partes (polo, nome e tipo;
--   sem CPF, nascimento ou endereco) devolvidos pela consulta oficial,
--   e quando foram lidos pela ultima vez.
-- So acrescenta colunas: nenhum dado existente e apagado.
-- ============================================================

ALTER TABLE legal_processes
  ADD COLUMN valor_causa DECIMAL(15,2) NULL,
  ADD COLUMN partes_json JSON NULL,
  ADD COLUMN dados_tribunal_em DATETIME NULL;
