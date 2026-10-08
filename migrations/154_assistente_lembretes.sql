-- ============================================================
-- Migration 154 — Assistente do WhatsApp: mais ações (08/10/2026)
-- Pedido "pode colocar todos": compromisso, lembrete, tarefa, recebimento,
-- pagar conta, cadastro e mensagem ao cliente também passam pelo "sim".
--  1) assistente_pendencias.tipo deixa de ser ENUM fixo (lancamento/baixa).
--  2) assistente_lembretes: "me lembra amanhã às 9h de..." → mensagem no
--     WhatsApp de QUEM pediu, na hora (cron a cada minuto). quando_utc em UTC.
-- ============================================================

ALTER TABLE assistente_pendencias MODIFY tipo VARCHAR(30) NOT NULL;

CREATE TABLE IF NOT EXISTS assistente_lembretes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  texto VARCHAR(400) NOT NULL,
  quando_utc DATETIME NOT NULL,
  enviado_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_assist_lemb_pend (enviado_at, quando_utc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
