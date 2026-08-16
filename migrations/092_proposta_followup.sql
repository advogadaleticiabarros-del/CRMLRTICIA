-- ============================================================
-- Migration 092 — Follow-up automático de propostas enviadas
-- 48h após o envio: lembrete. 5 dias: aviso de vencimento próximo +
-- disposição pra negociar. 7 dias: encerramento (marca expirada).
-- enviada_em é o "relógio zero" — carimbado na 1ª vez que o link é
-- gerado (compartilhar/e-mail) ou o status vira 'enviada' manualmente.
-- ============================================================

ALTER TABLE propostas
  MODIFY COLUMN status ENUM('rascunho','enviada','em_negociacao','aceita','recusada','expirada') NOT NULL DEFAULT 'rascunho',
  ADD COLUMN enviada_em      DATETIME NULL,
  ADD COLUMN followup_48h_at DATETIME NULL,
  ADD COLUMN followup_5d_at  DATETIME NULL,
  ADD COLUMN followup_7d_at  DATETIME NULL;
