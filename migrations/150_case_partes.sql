-- ============================================================
-- Migration 150 — Partes do processo
-- Pedido 02/10/2026: parte contrária não é cliente. Ela (e testemunhas,
-- perito) fica no caso; o caso diz de que lado o cliente está.
-- polo_cliente: ativo (autor/reclamante) | passivo (réu/reclamado).
-- ============================================================

ALTER TABLE cases ADD COLUMN polo_cliente VARCHAR(10) NOT NULL DEFAULT 'ativo';

CREATE TABLE IF NOT EXISTS case_partes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id INT UNSIGNED NOT NULL,
  papel VARCHAR(20) NOT NULL DEFAULT 'contraria',
  nome VARCHAR(255) NOT NULL,
  cpf_cnpj VARCHAR(20) NULL,
  endereco VARCHAR(500) NULL,
  email VARCHAR(255) NULL,
  advogado VARCHAR(255) NULL,
  advogado_oab VARCHAR(30) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_case_partes_case (case_id),
  KEY idx_case_partes_doc (cpf_cnpj),
  CONSTRAINT fk_case_partes_case FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
)
