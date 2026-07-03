-- Retratos diários de métricas do cockpit (para sparklines / tendências)
CREATE TABLE IF NOT EXISTS metric_snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  metric_key VARCHAR(40) NOT NULL,
  value DECIMAL(16,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_snap (snapshot_date, metric_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
