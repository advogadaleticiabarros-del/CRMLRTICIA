-- ============================================================
-- Migration 095 — Data de nascimento do cliente (aniversariantes no briefing)
-- Campo novo, opcional — preenchido aos poucos conforme o cadastro é
-- atualizado. Sem retroatividade: clientes antigos ficam sem aniversário
-- no briefing até alguém preencher.
-- ============================================================

ALTER TABLE clients ADD COLUMN birth_date DATE NULL;
