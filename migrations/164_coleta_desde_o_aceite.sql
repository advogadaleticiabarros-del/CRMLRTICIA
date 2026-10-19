-- A coleta de documentos (Dra. Camila) começa no aceite da proposta, sem
-- esperar a assinatura e o caso (pedido da Jessica, 19/10/2026: "acabamos de
-- fechar um contrato, preciso que os agentes entrem em ação").
-- A coleta nasce ligada ao CONTRATO; quando o caso é criado, ganha o case_id.
ALTER TABLE coletas_documentos
  MODIFY case_id INT UNSIGNED NULL,
  ADD COLUMN contract_id INT UNSIGNED NULL,
  ADD UNIQUE KEY uq_coleta_contrato (contract_id);

-- O aceite da proposta criava a ficha do cliente mas não ligava o lead a ela
-- (o RG, o estado civil e a profissão do atendimento ficavam de fora da ficha).
UPDATE leads l
  JOIN propostas p ON p.lead_id = l.id
   SET l.client_id = p.client_id
 WHERE l.client_id IS NULL AND p.client_id IS NOT NULL AND p.status = 'aceita';
