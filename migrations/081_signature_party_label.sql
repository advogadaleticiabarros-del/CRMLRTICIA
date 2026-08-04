-- ============================================================
-- Migration 081 — Link de assinatura exclusivo por signatario
-- Cada assinante ganha seu proprio link (token), ja identificado
-- com nome/CPF/papel (ex.: Notificante, Advogada, Contratante),
-- em vez de um link generico compartilhado entre todos.
-- ============================================================

ALTER TABLE signature_requests
  ADD COLUMN party_label VARCHAR(60) NULL
