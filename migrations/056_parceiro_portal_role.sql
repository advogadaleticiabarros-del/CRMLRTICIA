-- Migration 056 — Adiciona 'parceiro_portal' ao ENUM role da tabela users
-- A migration 054 criou a coluna partner_id mas esqueceu de expandir o ENUM,
-- causando erro MySQL ao tentar criar usuários com papel parceiro_portal.

ALTER TABLE users
  MODIFY COLUMN role
    ENUM('admin','advogado','estagiario','parceiro','cliente','staff','parceiro_portal')
    NOT NULL DEFAULT 'advogado';
