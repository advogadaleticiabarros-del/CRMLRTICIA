-- Migration 071 — Assunto específico da demanda dativa
-- A "área" (criminal, família...) é ampla; o assunto é o caso concreto
-- (ex.: tráfico de drogas, divórcio litigioso, furto). Aparece como etiqueta.
ALTER TABLE dative_cases ADD COLUMN assunto VARCHAR(200) NULL DEFAULT NULL;
