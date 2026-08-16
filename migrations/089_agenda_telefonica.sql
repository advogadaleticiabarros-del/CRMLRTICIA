-- ============================================================
-- Migration 089 — Agenda telefônica + nome que o WhatsApp já mostra
--
-- 1) push_name: o WhatsApp manda o nome que a própria pessoa cadastrou
--    no aparelho dela (senderName/wa_name) — guardamos por telefone pra
--    usar como nome do contato quando não há cliente/lead vinculado.
-- 2) phonebook_contacts: agenda telefônica própria do escritório — fórum,
--    parceiros, e qualquer contato útil que não necessariamente já
--    trocou mensagem pelo WhatsApp do CRM.
-- ============================================================

ALTER TABLE whatsapp_chat_meta ADD COLUMN push_name VARCHAR(255) NULL;

CREATE TABLE IF NOT EXISTS phonebook_contacts (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  phone      VARCHAR(30)  NOT NULL,
  category   VARCHAR(20)  NOT NULL DEFAULT 'outro', -- forum | parceiro | cliente | outro
  notes      VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_phonebook_phone (phone),
  INDEX idx_phonebook_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
