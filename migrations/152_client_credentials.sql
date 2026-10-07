-- ============================================================
-- Migration 152 — Senha do Meu INSS do cliente (tabela própria)
-- Pedido 07/10/2026: a senha fica na ficha do cliente, no banco do CRM.
-- Tabela separada de `clients` para não sair em SELECT * (listas,
-- exportações, IA, Obsidian); lida só por GET /api/clients/:id/senha-inss.
-- ============================================================

CREATE TABLE IF NOT EXISTS client_credentials (
  client_id INT UNSIGNED NOT NULL PRIMARY KEY,
  senha_inss VARCHAR(100) NULL,
  updated_by INT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_client_credentials_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
)
