-- ============================================================
-- Migration 072 — Esteira de produção: etapa "Em análise" (antes da
-- separação de docs) + etapa "Recusado" (trava, exige motivo, reversível)
-- ============================================================

ALTER TABLE cases
  MODIFY COLUMN production_stage ENUM(
    'em_analise','separacao_documentos','criacao_inicial','revisao_inicial',
    'aguardando_protocolo','protocolado','concluido','recusado'
  ) NULL;

ALTER TABLE cases
  ADD COLUMN rejection_reason TEXT NULL DEFAULT NULL,
  ADD COLUMN rejection_notes TEXT NULL DEFAULT NULL,
  ADD COLUMN rejected_at DATETIME NULL DEFAULT NULL,
  ADD COLUMN rejected_by INT NULL DEFAULT NULL,
  ADD COLUMN stage_before_rejection VARCHAR(40) NULL DEFAULT NULL;
