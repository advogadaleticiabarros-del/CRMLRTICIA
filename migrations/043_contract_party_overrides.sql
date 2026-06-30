-- ============================================================
-- Migration 043 — Complemento de informações do contrato (persistente)
-- Guarda no contrato os dados completados no painel "Completar informações"
-- (nacionalidade, profissão, CPF, e-mail, endereço, forma de pagamento), para
-- que não se percam e regerem os documentos automaticamente ao alterar.
-- ============================================================

ALTER TABLE contracts
  ADD COLUMN party_overrides JSON NULL;
