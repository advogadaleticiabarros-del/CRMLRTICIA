-- Contrato com mais de um contratante (19/10/2026: casal no mesmo processo).
-- Os dados dos outros contratantes ficam em party_overrides.co_contratantes;
-- aqui ficam a procuração e a declaração INDIVIDUAIS de cada um deles:
-- [{ "nome": "...", "cpf": "...", "procuracao": "...", "declaracao": "..." }].
ALTER TABLE contracts ADD COLUMN documentos_partes JSON NULL;
