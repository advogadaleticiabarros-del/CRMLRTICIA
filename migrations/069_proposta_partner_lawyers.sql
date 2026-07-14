-- Migration 069 - Advogados parceiros na proposta publica
-- Campo livre para exibir "Em parceria com ..." quando houver atuacao conjunta.

ALTER TABLE propostas
  ADD COLUMN partner_lawyers TEXT NULL;
