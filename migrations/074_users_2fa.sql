-- ============================================================
-- Migration 074 — Segundo fator (TOTP) no login.
-- totp_secret fica CIFRADO (AES-256-GCM, mesma chave dos tokens).
-- ============================================================

ALTER TABLE users
  ADD COLUMN totp_secret VARCHAR(512) NULL DEFAULT NULL,
  ADD COLUMN totp_enabled TINYINT(1) NOT NULL DEFAULT 0;
