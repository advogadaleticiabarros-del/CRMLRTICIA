-- ============================================================
-- Migration 029 — Evidências da assinatura eletrônica avançada
-- Reforça o valor probatório (Lei 14.063/2020): identificação,
-- consentimento LGPD, geolocalização, selfie e trilha de eventos.
-- ============================================================

ALTER TABLE signature_requests
  ADD COLUMN signer_email  VARCHAR(255)  NULL,
  ADD COLUMN signer_phone  VARCHAR(30)   NULL,
  ADD COLUMN geo_lat       DECIMAL(10,7) NULL,
  ADD COLUMN geo_lng       DECIMAL(10,7) NULL,
  ADD COLUMN geo_accuracy  INT           NULL,
  ADD COLUMN consent_lgpd  TINYINT(1)    NOT NULL DEFAULT 0,
  ADD COLUMN selfie_image  LONGTEXT      NULL,
  ADD COLUMN event_log     JSON          NULL;
