-- Prazo certo de cada intimação + relatório diário (pedido da Dra., 13/11/2026).
-- detected_deadlines passa a guardar a data limite já calculada (due_date, que
-- já existia), o "protocolar até" (um dia útil antes) e a análise completa
-- (rito, ato, fundamento, explicação da contagem). Só adiciona colunas que
-- aceitam NULL: as linhas antigas continuam como estão.
ALTER TABLE detected_deadlines
  ADD COLUMN protocolar_ate DATE NULL AFTER due_date,
  ADD COLUMN analise        JSON NULL AFTER protocolar_ate;

-- Envios do relatório diário de intimações: guarda até qual movimentação já
-- foi relatada, para o relatório seguinte trazer só as novas.
CREATE TABLE IF NOT EXISTS relatorio_intimacoes_envios (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ate_movement_id  INT UNSIGNED NOT NULL,
  publicacoes      INT UNSIGNED NOT NULL DEFAULT 0,
  prazos           INT UNSIGNED NOT NULL DEFAULT 0,
  email_ok         TINYINT(1)   NOT NULL DEFAULT 0,
  whatsapp_ok      TINYINT(1)   NOT NULL DEFAULT 0,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rel_intim_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
