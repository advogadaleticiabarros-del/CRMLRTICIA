-- ============================================================
-- Migration 046 — Etiqueta de área no cliente
-- Ao fechar/assinar um contrato, o cliente é etiquetado com a área em que é
-- cliente (ex.: Cível). Um cliente pode ter mais de uma área.
-- ============================================================

ALTER TABLE clients
  ADD COLUMN areas JSON NULL;

-- Backfill: preenche as áreas a partir dos casos já existentes de cada cliente.
UPDATE clients c
   SET c.areas = (
     SELECT JSON_ARRAYAGG(a) FROM (
       SELECT DISTINCT ca.legal_area AS a FROM cases ca
        WHERE ca.client_id = c.id AND ca.legal_area IS NOT NULL
     ) t
   )
 WHERE EXISTS (SELECT 1 FROM cases ca WHERE ca.client_id = c.id AND ca.legal_area IS NOT NULL);
