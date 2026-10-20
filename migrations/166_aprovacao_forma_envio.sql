-- Fila de aprovação guarda COMO a mensagem sai depois de aprovada (20/10/2026).
-- As automações antigas a cliente (acompanhamento de proposta, recusa,
-- expiração, aceite com PIX, newsletter, e-book) passaram a ser rascunho;
-- algumas têm botões nativos e uma pendência que o webhook espera, ou o botão
-- de PIX. NULL = texto simples (como já era para os agentes).
-- {"tipo":"botoes","botoes":["Sim|id"],"pendencia":{...}} | {"tipo":"texto_pix","pix":{...}}
ALTER TABLE atendente_rascunhos ADD COLUMN envio JSON NULL;
