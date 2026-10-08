-- ============================================================
-- Migration 153 — Assistente pessoal do CRM pelo WhatsApp (08/10/2026)
-- Pendências de confirmação ("sim"/"não") do assistente: lançamentos de
-- contas a pagar/gastos e baixas de comprovante de cliente. phone_chave =
-- DDD + 8 últimos dígitos (o WhatsApp às vezes manda o número sem o 9).
-- grupo: a mesma baixa perguntada às duas comandantes fecha junto.
-- ============================================================

CREATE TABLE IF NOT EXISTS assistente_pendencias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  phone_chave VARCHAR(12) NOT NULL,
  tipo ENUM('lancamento','baixa') NOT NULL,
  payload JSON NOT NULL,
  resumo VARCHAR(300) NOT NULL,
  grupo VARCHAR(60) NULL,
  status ENUM('aberta','confirmada','cancelada','substituida') NOT NULL DEFAULT 'aberta',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  INDEX idx_assist_pend_chave (phone_chave, status),
  INDEX idx_assist_pend_grupo (grupo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
