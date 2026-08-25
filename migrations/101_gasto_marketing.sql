-- Migration 101 — Tabela de gasto de marketing por mês/canal
-- Lançamento 100% manual (sem integração com Meta Ads/Google Ads API).
-- UNIQUE KEY (mes_referencia, canal) garante um único valor por mês+canal —
-- lançar de novo faz upsert (ON DUPLICATE KEY UPDATE), não duplica linha.

CREATE TABLE gasto_marketing (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mes_referencia DATE NOT NULL,
  canal VARCHAR(60) NOT NULL,
  valor DECIMAL(10,2) NOT NULL,
  created_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_mes_canal (mes_referencia, canal)
);
