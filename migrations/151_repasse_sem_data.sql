-- ============================================================
-- Migration 151 — Repasse a parceiro "pendente de data"
-- Pedido 02/10/2026: repasse de êxito à parceira (ex.: Infinity Law) fica sem
-- vencimento até o dinheiro entrar; data_vencimento NULL = "sem data definida".
-- ============================================================

ALTER TABLE repasses MODIFY data_vencimento DATE NULL
