-- ============================================================
-- Migration 125 — Extensão única de prazo na proposta expirada (7 dias)
-- Pedido da Dra. Letícia (decisão comercial tomada pelo Claude a pedido
-- dela): quando a proposta expira em 7 dias sem resposta, em vez de só
-- avisar que encerrou, oferece 2 botões — "Preciso de mais tempo" e
-- "Recusar" — e concede UMA ÚNICA extensão de prazo se pedir mais tempo.
--
-- prazo_estendido_em: NULL até a extensão ser concedida. Marca que a
-- extensão de 7 dias já foi usada uma vez — se já tiver valor, o sistema
-- não concede de novo (ver concederExtensaoPrazo em propostaFollowupService.ts).
-- Também é o marco a partir do qual o cron de fechamento definitivo conta
-- mais 7 dias antes de encerrar de vez, sem oferecer 3ª chance.
-- ============================================================

ALTER TABLE propostas
  ADD COLUMN prazo_estendido_em DATETIME NULL AFTER followup_7d_at;
