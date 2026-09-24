-- ============================================================
-- Migration 134 — Consentimento LGPD explícito no cadastro de cliente
-- Achado da auditoria do módulo Clientes (23/09/2026): só existia opt-in de
-- newsletter pra lead — nada formalizava o consentimento de tratamento de
-- dado do cliente em si. Campo opcional, marcado manualmente no
-- cadastro/edição; NULL = nunca registrado ou revogado.
-- ============================================================

ALTER TABLE clients ADD COLUMN lgpd_consent_at DATETIME NULL;
