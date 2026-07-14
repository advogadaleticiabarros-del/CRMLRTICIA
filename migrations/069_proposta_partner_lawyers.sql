-- Migration 069 - Advogados parceiros na proposta publica
-- A criacao da coluna e feita de forma tolerante pela aplicacao para evitar
-- falha de healthcheck em deploy parcial. Mantemos a migration registrada.

SELECT 1;
