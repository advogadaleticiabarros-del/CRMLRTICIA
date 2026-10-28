-- Contratos do cliente lidos nos documentos (28/10/2026, regra da Jessica): o
-- extrato do INSS traz todos os contratos, de todos os bancos. Cada contrato
-- fica guardado uma vez por cliente, com o tipo (RMC, RCC, empréstimo...) e o
-- banco, e a Dra. diz em qual processo ele entra: case_id (este caso) ou
-- fora = 1 (nenhuma peça). Sem decisão, vale a regra automática: só entra na
-- peça o contrato do mesmo banco do réu e da mesma tese.
-- chave: nº do contrato sem pontuação (ou banco + tipo + data, sem número).
-- Só cria tabela nova: nada muda nos dados existentes.
CREATE TABLE IF NOT EXISTS cliente_contratos (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id    INT UNSIGNED NOT NULL,
  chave        VARCHAR(160) NOT NULL,
  numero       VARCHAR(80)  NULL,
  tipo         VARCHAR(40)  NULL,
  banco        VARCHAR(255) NULL,
  dados        JSON         NOT NULL,
  case_id      INT UNSIGNED NULL,
  fora         TINYINT(1)   NOT NULL DEFAULT 0,
  decidido_por INT UNSIGNED NULL,
  decidido_em  DATETIME     NULL,
  lido_em      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cliente_contratos (client_id, chave),
  KEY idx_cliente_contratos_case (case_id),
  CONSTRAINT fk_cliente_contratos_cliente FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT fk_cliente_contratos_caso    FOREIGN KEY (case_id)   REFERENCES cases(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
