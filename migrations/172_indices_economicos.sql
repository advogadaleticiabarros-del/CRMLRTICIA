-- Índices econômicos mensais do Bacen (28/10/2026, Calculista da planilha de
-- cálculos da peça): INPC (série SGS 188), IPCA (433) e Selic acumulada no mês
-- (4390), em % ao mês. Guardados aqui para a planilha não depender da API do
-- Bacen, que às vezes falha. Só meses fechados (a Selic do mês corrente é
-- parcial). competencia = 'aaaa-mm'.
-- Só cria tabela nova: nada muda nos dados existentes.
CREATE TABLE IF NOT EXISTS indices_economicos (
  serie         VARCHAR(10)   NOT NULL,
  competencia   CHAR(7)       NOT NULL,
  valor         DECIMAL(10,4) NOT NULL,
  atualizado_em DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (serie, competencia)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
