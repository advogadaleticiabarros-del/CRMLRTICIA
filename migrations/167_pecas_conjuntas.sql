-- Petição inicial conjunta (21/10/2026, regra da Jessica): casos do mesmo
-- cliente contra a mesma parte contrária saem numa única peça. Cada caso
-- coberto pela peça ganha uma linha; o caso principal é o que a gerou.
-- Só cria tabela nova: nada muda nos dados existentes.
CREATE TABLE IF NOT EXISTS pecas_conjuntas (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_id       INT UNSIGNED NOT NULL,
  case_id           INT UNSIGNED NOT NULL,
  case_principal_id INT UNSIGNED NOT NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pecas_conjuntas (document_id, case_id),
  KEY idx_pecas_conjuntas_case (case_id),
  CONSTRAINT fk_pecas_conjuntas_doc  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_pecas_conjuntas_case FOREIGN KEY (case_id)     REFERENCES cases(id)     ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
