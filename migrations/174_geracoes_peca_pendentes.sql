-- Geração da peça que sobrevive a um reinício (30/10/2026). Caso real: a Jessica
-- pediu uma nova versão da peça e ela nunca chegou, porque uma publicação reiniciou
-- o CRM no meio da geração. Cada geração em andamento fica aqui até terminar; no
-- início do CRM, o que sobrou é gerado de novo (src/services/geracaoPeca.ts).
-- Só cria tabela nova: nada muda nos dados existentes.
CREATE TABLE IF NOT EXISTS geracoes_peca_pendentes (
  alvo_case_id INT          NOT NULL,
  case_id      INT          NOT NULL,
  user_id      INT          NOT NULL,
  origem       VARCHAR(10)  NOT NULL,
  titulo       VARCHAR(255) NULL,
  tentativas   INT          NOT NULL DEFAULT 0,
  iniciado_em  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (alvo_case_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
