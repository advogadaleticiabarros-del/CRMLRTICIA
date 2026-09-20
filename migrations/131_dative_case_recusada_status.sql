-- ============================================================
-- Migration 131 — Status "Recusada" nos casos dativos (motivo obrigatorio)
-- Pedido da Dra. Leticia: nomeacoes dativas detectadas (DJEN/OAB) ou
-- cadastradas manualmente que ela recusa precisam ficar registradas —
-- hoje so dava pra excluir a demanda, perdendo o historico de que ela
-- foi nomeada e recusou, e por que. Mesmo padrao ja usado em
-- cases.production_stage = 'recusado' (migration 072): trava o status,
-- exige motivo, e so sai revertendo (POST /reject/revert).
-- ============================================================

ALTER TABLE dative_cases
  MODIFY COLUMN status ENUM('nomeada','em_andamento','concluida','a_receber','paga','recusada') NOT NULL DEFAULT 'nomeada';

ALTER TABLE dative_cases
  ADD COLUMN rejection_reason TEXT NULL DEFAULT NULL,
  ADD COLUMN rejected_at DATETIME NULL DEFAULT NULL,
  ADD COLUMN status_before_rejection VARCHAR(20) NULL DEFAULT NULL;
