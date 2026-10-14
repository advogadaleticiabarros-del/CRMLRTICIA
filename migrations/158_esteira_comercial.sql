-- Esteira comercial do escritório virtual (Produtor de proposta, Fechador de
-- contrato, Coletor de documentos e provas).
-- esteira_avisos: "já fiz este passo" (um por ref + marco), para nenhuma
-- mensagem sair duas vezes. coletas_documentos: a lista de documentos e provas
-- pedida ao cliente de cada caso, e quando ficou completa.
CREATE TABLE IF NOT EXISTS esteira_avisos (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ref         VARCHAR(80)  NOT NULL,
  marco       VARCHAR(40)  NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_esteira_ref_marco (ref, marco)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coletas_documentos (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id       INT UNSIGNED NOT NULL,
  client_id     INT UNSIGNED NOT NULL,
  area          VARCHAR(40)  NULL,
  itens         JSON         NOT NULL,
  pedido_em     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  concluido_em  DATETIME     NULL,
  relato_doc_id INT UNSIGNED NULL,
  UNIQUE KEY uq_coleta_case (case_id),
  CONSTRAINT fk_coleta_case FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
