-- ============================================================
-- Migration 179 — Caminho do pagamento do dativo (pedido da Dra., 13/11/2026)
-- Nomeacao (aceite) -> atuacao -> certidao -> e-Flow (protocolo) -> e-Docs
-- (deferido ou indeferido) -> lista da Sefaz -> saque no banco (baixa).
-- Novas etapas no status: protocolada, deferida, indeferida.
-- So acrescenta colunas e valores de ENUM: nenhum dado existente muda.
-- IMPORTANTE: o runner divide por ponto e virgula e remove linhas iniciadas
-- por dois tracos, entao nenhum conteudo abaixo contem esses caracteres.
-- ============================================================

ALTER TABLE dative_cases
  MODIFY COLUMN status ENUM('nomeada','em_andamento','concluida','aguardando_liberacao_requerimento','protocolada','deferida','indeferida','a_receber','paga','recusada') NOT NULL DEFAULT 'nomeada';

ALTER TABLE dative_cases
  ADD COLUMN aceite_date DATE NULL,
  ADD COLUMN certidao_date DATE NULL,
  ADD COLUMN eflow_protocolo VARCHAR(80) NULL,
  ADD COLUMN eflow_protocolo_date DATE NULL,
  ADD COLUMN decisao_pagamento ENUM('deferido','indeferido') NULL,
  ADD COLUMN decisao_pagamento_date DATE NULL,
  ADD COLUMN decisao_pagamento_motivo VARCHAR(500) NULL,
  ADD COLUMN sefaz_lista_date DATE NULL,
  ADD COLUMN sefaz_lista_ref VARCHAR(120) NULL;

CREATE INDEX idx_dative_cases_eflow_protocolo ON dative_cases (eflow_protocolo);
