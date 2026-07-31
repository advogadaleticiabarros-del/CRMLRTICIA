-- ============================================================
-- Migration 080 — Papel "comercial" (gestao de leads, propostas
-- e fechamento de contratos, sem acesso a financeiro/processual)
-- ============================================================

ALTER TABLE users
  MODIFY COLUMN role
  ENUM('admin','advogado','estagiario','parceiro','cliente','staff','parceiro_portal','comercial')
  NOT NULL DEFAULT 'advogado'
