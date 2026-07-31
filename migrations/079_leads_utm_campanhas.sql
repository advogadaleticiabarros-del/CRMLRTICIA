-- ============================================================
-- Migration 079 — Rastreio de campanha nos leads (UTM)
-- Prepara o CRM para receber leads de site, Instagram, Meta Ads
-- e Google Ads com origem identificável, nao so um texto solto
-- em "source". IMPORTANTE: sem ';' dentro do conteudo, runner
-- divide por ';'.
-- ============================================================

ALTER TABLE leads
  ADD COLUMN utm_source   VARCHAR(100) NULL,
  ADD COLUMN utm_medium   VARCHAR(100) NULL,
  ADD COLUMN utm_campaign VARCHAR(150) NULL,
  ADD COLUMN utm_content  VARCHAR(150) NULL,
  ADD COLUMN utm_term     VARCHAR(150) NULL,
  ADD COLUMN landing_page VARCHAR(500) NULL
