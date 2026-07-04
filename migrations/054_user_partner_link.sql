-- ============================================================
-- Migration 054 — Vínculo usuário ↔ parceiro (portal do parceiro)
-- Um usuário com papel 'parceiro_portal' representa uma empresa parceira
-- (partners.id) e só enxerga os casos que ela indicou.
-- ============================================================

ALTER TABLE users
  ADD COLUMN partner_id INT UNSIGNED NULL,
  ADD INDEX idx_users_partner (partner_id)
