-- ============================================================
-- Migration 116 — Matching por significado no Cofre de Peças (Fase 3)
-- Guarda o "embedding" (vetor de significado, gerado pela OpenAI) de cada
-- peça do cofre, pra achar o modelo certo mesmo quando o caso é descrito
-- com palavras diferentes das do título/assunto da peça — hoje o match é só
-- por contagem de palavra repetida (findPecaModelo em aiAssistant.ts).
-- embedded_at marca quando foi calculado, pra saber quem falta backfillar
-- e permitir recalcular no futuro se trocar de modelo de embedding.
-- IMPORTANTE: o runner divide por ';' e remove linhas iniciadas por '--',
-- entao nenhum conteudo abaixo contem ';' nem linha comecando com '--'.
-- ============================================================

ALTER TABLE peca_modelos
  ADD COLUMN embedding LONGTEXT NULL,
  ADD COLUMN embedded_at DATETIME NULL
