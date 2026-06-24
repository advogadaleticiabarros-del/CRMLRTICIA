-- ============================================================
-- Migration 030 — Link de assinatura externa (ZapSign) no contrato
-- ============================================================

ALTER TABLE contracts ADD COLUMN zapsign_link VARCHAR(1000) NULL;
