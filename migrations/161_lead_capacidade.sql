-- Dr. Otávio (copiloto comercial): qualificação do possível cliente em %.
-- capacidade_pct = consegue pagar; potencial_pct = o caso vale para o escritório;
-- fechamento_pct = chance de fechar. capacidade_sinais guarda os sinais lidos da
-- conversa e o cálculo (motivos), para a Dra. ver por que deu aquela porcentagem.
ALTER TABLE leads
  ADD COLUMN capacidade_pct    TINYINT UNSIGNED NULL,
  ADD COLUMN potencial_pct     TINYINT UNSIGNED NULL,
  ADD COLUMN fechamento_pct    TINYINT UNSIGNED NULL,
  ADD COLUMN capacidade_sinais JSON             NULL,
  ADD COLUMN capacidade_em     DATETIME         NULL;
