-- ============================================================
-- Migration 149 — Resultado do caso (taxa de sucesso)
-- Pedido 02/10/2026: medir taxa de sucesso e % obtido sobre o valor da causa.
-- resultado: acordo | procedente | procedente_parcial | improcedente |
-- renuncia | desistencia | arquivado_sem_julgamento | NULL (em andamento).
-- valor_obtido: total que a parte recebeu (acordo/condenação/execução).
-- ============================================================

ALTER TABLE cases
  ADD COLUMN resultado VARCHAR(30) NULL,
  ADD COLUMN valor_obtido DECIMAL(14,2) NULL,
  ADD COLUMN resultado_em DATE NULL
