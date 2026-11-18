-- ============================================================
-- Migration 186 — Chave do autenticador (2 fatores) do login do TRT17, 18/11/2026
-- O login nacional do PJe pede o codigo do autenticador. A Dra. escolheu deixar
-- o CRM gerar o codigo: guarda a chave (TOTP) CRIPTOGRAFADA pelo utils/crypto,
-- igual a senha. Coluna nova e opcional: nenhum dado existente muda.
-- IMPORTANTE: o runner divide por ponto e virgula e remove linhas iniciadas
-- por dois tracos, entao nenhum conteudo abaixo contem esses caracteres.
-- ============================================================

ALTER TABLE mni_credenciais
  ADD COLUMN totp_enc TEXT NULL AFTER senha_enc
