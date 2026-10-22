-- Mesa do caso (22/10/2026): a Dra. edita e formata a peça dentro do CRM.
-- content_html: a peça com formatação (lista fechada de marcações, limpa no servidor);
--   content continua com o texto puro, que a revisão e a Dra. Vera leem.
-- versao_de: a versão da Dra. aponta para a versão da equipe que ela editou
--   (a da equipe fica intacta para comparar e aprender).
-- final_em: versão final marcada (vai para o Jusbrasil). Só colunas novas, nulas.
ALTER TABLE documents
  ADD COLUMN content_html LONGTEXT NULL,
  ADD COLUMN versao_de INT UNSIGNED NULL,
  ADD COLUMN final_em DATETIME NULL;

-- O que a equipe aprende com cada correção da Dra. Regra aprovada vale para as
-- próximas peças da área; "caso" vale só para o caso; "pendente" espera a Dra.
CREATE TABLE IF NOT EXISTS peca_licoes (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id      INT UNSIGNED NOT NULL,
  area         VARCHAR(40)  NULL,
  document_id  INT UNSIGNED NOT NULL,
  titulo       VARCHAR(200) NOT NULL,
  mudou        TEXT         NOT NULL,
  regra        TEXT         NOT NULL,
  decisao      VARCHAR(10)  NOT NULL DEFAULT 'pendente',
  decidida_por INT UNSIGNED NULL,
  decidida_em  DATETIME     NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_peca_licoes_case (case_id),
  KEY idx_peca_licoes_area (area, decisao),
  CONSTRAINT fk_peca_licoes_case FOREIGN KEY (case_id)     REFERENCES cases(id)     ON DELETE CASCADE,
  CONSTRAINT fk_peca_licoes_doc  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
