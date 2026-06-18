-- ============================================================
-- Migration 008 — Vínculo demanda dativa ↔ ficha de cliente (etiqueta DATIVO)
-- FullCycle Squad — DBA: Lucas
-- ============================================================

-- Etiqueta DATIVO na ficha do cliente
ALTER TABLE clients
  ADD COLUMN is_dative TINYINT(1) NOT NULL DEFAULT 0,
  ADD INDEX idx_clients_dative (is_dative);

-- Vincula a demanda dativa à ficha do cliente (assistido)
ALTER TABLE dative_cases
  ADD COLUMN client_id INT UNSIGNED NULL,
  ADD INDEX idx_dative_cases_client (client_id),
  ADD CONSTRAINT fk_dative_cases_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
