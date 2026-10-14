-- Leitor de sentença/acórdão (escritório virtual): guarda a leitura que a IA
-- fez de cada decisão e serve de trava para não mandar a mesma leitura duas
-- vezes à Dra. quando o tribunal republica a decisão. `chave` = hash do
-- processo + tipo + começo do texto normalizado (src/services/leitorDecisao.ts).
CREATE TABLE IF NOT EXISTS decisao_leituras (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  process_id  INT UNSIGNED NOT NULL,
  chave       CHAR(64)     NOT NULL,
  tipo        VARCHAR(20)  NOT NULL,
  resultado   VARCHAR(40)  NOT NULL,
  favoravel   VARCHAR(20)  NOT NULL,
  leitura     JSON         NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_decisao_chave (chave),
  INDEX idx_dl_process (process_id),
  CONSTRAINT fk_dl_process FOREIGN KEY (process_id) REFERENCES legal_processes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
