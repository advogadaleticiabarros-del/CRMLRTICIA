-- Migration 066 — Observação fixa por card na esteira de produção
ALTER TABLE cases ADD COLUMN production_obs TEXT NULL DEFAULT NULL;
