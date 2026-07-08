-- ============================================================
-- Migration 055 — Papel 'parceiro_portal' no ENUM de users.role
-- Usuário que representa uma empresa parceira e acessa apenas
-- o portal do parceiro (casos indicados por ela).
-- ============================================================

ALTER TABLE users
  MODIFY COLUMN role ENUM('admin','advogado','estagiario','parceiro','cliente','staff','parceiro_portal') NOT NULL DEFAULT 'advogado'
