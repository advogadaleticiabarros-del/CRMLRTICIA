-- Migration 067 — Data de protocolo por caso (relatório mensal da parceria)
ALTER TABLE cases ADD COLUMN protocoled_at DATETIME NULL DEFAULT NULL;

-- Preenche retroativamente os casos já protocolados/concluídos:
-- usa a data do log "→ Protocolado" (production_notes); se não houver,
-- cai para o início da produção.
UPDATE cases c
LEFT JOIN (
  SELECT case_id, MIN(created_at) AS dt
  FROM production_notes
  WHERE text LIKE '%Protocolado%'
  GROUP BY case_id
) pn ON pn.case_id = c.id
SET c.protocoled_at = COALESCE(pn.dt, c.production_started_at)
WHERE c.production_stage IN ('protocolado', 'concluido')
  AND c.protocoled_at IS NULL;
