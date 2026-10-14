-- Escritório virtual e Métricas da IA.
-- ia_uso_diario: quantas chamadas cada provedor de IA recebeu por dia
-- (openai, openai_smart, groq, gemini, laya) — base do "IA sem custo".
-- agente_acoes: o que cada agente fez (texto curto), mostrado no balão do
-- agente na sala e no painel dele. Sem dado pessoal sensível no texto.
CREATE TABLE IF NOT EXISTS ia_uso_diario (
  dia       DATE        NOT NULL,
  provedor  VARCHAR(20) NOT NULL,
  chamadas  INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (dia, provedor)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agente_acoes (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agente      VARCHAR(40)  NOT NULL,
  texto       VARCHAR(300) NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_aa_agente (agente, created_at),
  INDEX idx_aa_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
