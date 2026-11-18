-- ============================================================
-- Migration 184 — Classificacao dos processos, partes e ficha completa (18/11/2026)
-- legal_processes: justica, instancia, classe, assuntos, orgao julgador,
--   polo da cliente e temperatura pelas decisoes (quente, morno, frio).
-- clients: RG, sexo, nome da mae e do pai, naturalidade e nacionalidade
--   (vindos do tribunal ou digitados).
-- process_parties: todas as partes de cada processo vindas do tribunal,
--   inclusive as contrarias, marcando as que o escritorio representa.
-- So acrescenta: nenhum dado existente e apagado.
-- IMPORTANTE: o runner divide por ponto e virgula e remove linhas iniciadas
-- por dois tracos, entao nenhum conteudo abaixo contem esses caracteres.
-- ============================================================

ALTER TABLE legal_processes
  ADD COLUMN justica VARCHAR(20) NULL,
  ADD COLUMN instancia VARCHAR(20) NULL,
  ADD COLUMN classe VARCHAR(200) NULL,
  ADD COLUMN assuntos VARCHAR(600) NULL,
  ADD COLUMN orgao_julgador VARCHAR(255) NULL,
  ADD COLUMN polo_cliente VARCHAR(10) NULL,
  ADD COLUMN temperatura VARCHAR(10) NULL,
  ADD COLUMN temperatura_confianca VARCHAR(10) NULL,
  ADD COLUMN temperatura_decisao VARCHAR(255) NULL,
  ADD COLUMN temperatura_decisao_em DATE NULL,
  ADD COLUMN temperatura_motivo VARCHAR(255) NULL,
  ADD COLUMN classificado_em DATETIME NULL;

ALTER TABLE clients
  ADD COLUMN rg VARCHAR(30) NULL,
  ADD COLUMN sexo CHAR(1) NULL,
  ADD COLUMN nome_mae VARCHAR(200) NULL,
  ADD COLUMN nome_pai VARCHAR(200) NULL,
  ADD COLUMN naturalidade VARCHAR(120) NULL,
  ADD COLUMN nacionalidade VARCHAR(60) NULL;

CREATE TABLE IF NOT EXISTS process_parties (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  process_id INT UNSIGNED NOT NULL,
  polo VARCHAR(10) NOT NULL,
  nome VARCHAR(200) NOT NULL,
  nome_norm VARCHAR(200) NOT NULL,
  tipo VARCHAR(10) NULL,
  documento VARCHAR(20) NULL,
  rg VARCHAR(30) NULL,
  data_nascimento DATE NULL,
  endereco VARCHAR(255) NULL,
  nome_mae VARCHAR(200) NULL,
  nossa_parte TINYINT(1) NOT NULL DEFAULT 0,
  client_id INT UNSIGNED NULL,
  fonte VARCHAR(20) NOT NULL DEFAULT 'mni',
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_parte (process_id, polo, nome_norm),
  INDEX idx_parte_doc (documento),
  INDEX idx_parte_cliente (client_id),
  CONSTRAINT fk_parte_processo FOREIGN KEY (process_id) REFERENCES legal_processes(id) ON DELETE CASCADE
);
