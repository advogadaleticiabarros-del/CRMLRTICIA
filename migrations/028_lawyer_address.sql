-- ============================================================
-- Migration 028 — Endereço do escritório no cadastro do advogado
-- Os documentos (CONTRATADA/OUTORGADA) passam a usar a advogada cadastrada.
-- ============================================================

ALTER TABLE lawyers ADD COLUMN address VARCHAR(500) NULL;

UPDATE lawyers SET address = 'London Office Tower, R. José Alexandre Buaiz, nº 160, Sala 115, Enseada do Suá, Vitória/ES, CEP 29.050-545', email = COALESCE(NULLIF(email, ''), 'advogadaleticia.barros@gmail.com / contato@advogadaleticiabarros.com') WHERE oab_number = '39948';
