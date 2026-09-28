-- ============================================================
-- Migration 137 — Selfie de verificacao OPCIONAL por link de assinatura
-- Ideia 12 (prioridade baixa) da auditoria do modulo Clientes: a advogada
-- escolhe, por link, se exige uma selfie do signatario (so registro, sem
-- comparacao facial). Foto do rosto e dado sensivel (LGPD), entao so e
-- pedida quando solicitada. 0 = nao pede (padrao), 1 = obrigatoria.
-- IMPORTANTE: o runner divide por ';' e remove linhas iniciadas por '--',
-- entao nenhum conteudo abaixo contem ';' nem linha comecando com '--'.
-- ============================================================

ALTER TABLE signature_requests
  ADD COLUMN require_selfie TINYINT(1) NOT NULL DEFAULT 0
