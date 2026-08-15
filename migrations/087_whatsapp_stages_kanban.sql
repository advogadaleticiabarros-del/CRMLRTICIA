-- ============================================================
-- Migration 087 — Quadro Kanban de contatos do WhatsApp
-- Etapas totalmente editáveis pela usuária (criar/renomear/apagar,
-- não é uma lista fixa no código). Mover um contato de coluna já
-- aplica a etiqueta com o mesmo nome da etapa (pedido explícito).
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_stages (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(60)  NOT NULL,
  color      VARCHAR(20)  NOT NULL DEFAULT '#6366f1',
  position   INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE whatsapp_chat_meta
  ADD COLUMN stage_id INT UNSIGNED NULL,
  ADD CONSTRAINT fk_wcm_stage FOREIGN KEY (stage_id) REFERENCES whatsapp_stages(id) ON DELETE SET NULL;

INSERT INTO whatsapp_stages (name, color, position) VALUES
  ('Novo contato', '#65aadd', 0),
  ('Arquivado', '#9aa0a6', 99);
