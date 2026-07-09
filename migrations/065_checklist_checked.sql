-- Migration 065 — Checklist de documentos com marcação manual por caso
ALTER TABLE cases ADD COLUMN checklist_checked JSON NULL DEFAULT NULL;
