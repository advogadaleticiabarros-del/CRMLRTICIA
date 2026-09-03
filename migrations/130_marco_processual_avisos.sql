-- Deduplica avisos de WhatsApp de marco processual (sentença/acórdão
-- publicado). Hoje cada movimentação nova que bate no gatilho dispara um
-- novo envio — se o mesmo marco chega via mais de uma fonte (DataJud e DJEN
-- publicando o mesmo evento como movimentações tecnicamente distintas) ou o
-- tribunal republica a decisão, o escritório recebe a mesma notícia várias
-- vezes (reportado pela usuária: "enviar múltiplas mensagens da mesma
-- movimentação e/ou processo"). Cada linha aqui marca "já avisamos este tipo
-- de marco pra este processo" — uma sentença/acórdão só gera 1 aviso por
-- processo, para sempre (o caso raro de uma segunda sentença de verdade no
-- mesmo processo, ex. após anulação, fica visível na tela de Processos).
CREATE TABLE IF NOT EXISTS marco_processual_avisos (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  process_id  INT UNSIGNED NOT NULL,
  marco_type  VARCHAR(60)  NOT NULL,
  sent_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_marco_process_type (process_id, marco_type),
  CONSTRAINT fk_mpa_process FOREIGN KEY (process_id) REFERENCES legal_processes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
