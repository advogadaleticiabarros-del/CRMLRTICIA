-- Metas comerciais mensais — meta de faturamento (recebido em caixa) por mês,
-- com histórico. A meta de um novo mês nasce automaticamente: se o mês
-- anterior bateu a meta, sobe 10%; senão, repete o mesmo valor. Sempre pode
-- ser ajustada manualmente (ver PUT /api/goals/current).
CREATE TABLE IF NOT EXISTS monthly_goals (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  month        CHAR(7)        NOT NULL,      -- 'YYYY-MM'
  target_value DECIMAL(14,2)  NOT NULL,
  source       VARCHAR(20)    NOT NULL DEFAULT 'auto', -- auto | manual
  created_at   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_monthly_goals_month (month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
