-- Migration 065 — Checklist de documentos com marcação manual por caso
-- (MySQL não aceita ADD COLUMN IF NOT EXISTS — sintaxe corrigida)
ALTER TABLE cases ADD COLUMN checklist_checked JSON NULL DEFAULT NULL;
