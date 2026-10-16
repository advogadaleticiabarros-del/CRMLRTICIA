-- Dr. Rafael (negociação) e Dra. Helena (analista de documentos).
-- atendente_rascunhos passa a guardar de qual agente é o rascunho: a Lívia
--   (atendimento) ou o Rafael (resposta às objeções da proposta).
-- documento_leituras: leitura crítica de cada arquivo (uma vez por arquivo,
--   para não pagar a IA de novo). analises_documentos: cada análise do caso.
ALTER TABLE atendente_rascunhos
  ADD COLUMN agente      VARCHAR(20)  NOT NULL DEFAULT 'atendente' AFTER id,
  ADD COLUMN objecoes    JSON         NULL,
  ADD COLUMN proposta_id INT UNSIGNED NULL;

CREATE TABLE IF NOT EXISTS documento_leituras (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ref         VARCHAR(60)  NOT NULL,
  fonte       VARCHAR(255) NOT NULL,
  leitura     JSON         NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_doc_leitura_ref (ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS analises_documentos (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id          INT UNSIGNED NOT NULL,
  client_id        INT UNSIGNED NOT NULL,
  documentos       INT UNSIGNED NOT NULL DEFAULT 0,
  graves           INT UNSIGNED NOT NULL DEFAULT 0,
  atencao          INT UNSIGNED NOT NULL DEFAULT 0,
  achados          JSON         NOT NULL,
  relatorio_doc_id INT UNSIGNED NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_analise_case (case_id, created_at),
  CONSTRAINT fk_analise_case FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
