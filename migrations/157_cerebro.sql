-- Cérebro (biblioteca do escritório): cópia das notas do cofre Obsidian e
-- seus trechos, com o vetor de significado de cada trecho para a busca.
-- `hash` evita reprocessar nota que não mudou; trechos de nota apagada no
-- cofre saem junto (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS cerebro_notas (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  caminho       VARCHAR(500) NOT NULL,
  titulo        VARCHAR(300) NOT NULL,
  pasta         VARCHAR(400) NOT NULL DEFAULT '',
  tags          JSON         NULL,
  links         JSON         NULL,
  conteudo      MEDIUMTEXT   NOT NULL,
  hash          CHAR(64)     NOT NULL,
  atualizado_em DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cerebro_caminho (caminho)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cerebro_trechos (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nota_id    INT UNSIGNED NOT NULL,
  ordem      SMALLINT UNSIGNED NOT NULL,
  texto      TEXT         NOT NULL,
  embedding  JSON         NULL,
  INDEX idx_ct_nota (nota_id),
  CONSTRAINT fk_ct_nota FOREIGN KEY (nota_id) REFERENCES cerebro_notas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
