-- ============================================================
-- Migration 012 — WhatsApp Inbox Completo
-- Integrado do server-legal-hub (schema.prisma → MySQL)
-- Inclui conversas, mensagens, tags e notas internas.
-- ============================================================

-- ─────────────────────────────────────────
-- whatsapp_conversations — caixa de entrada por contato
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id                INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  contact_name      VARCHAR(255)  NOT NULL,
  phone_number      VARCHAR(30)   NOT NULL,
  status            VARCHAR(30)   NOT NULL DEFAULT 'open',
  -- open | waiting_client | waiting_internal | closed
  origin            VARCHAR(30)   NOT NULL DEFAULT 'manual',
  -- manual | whatsapp | webhook
  pipeline_stage    VARCHAR(50)   NOT NULL DEFAULT 'novo_lead',
  last_message      TEXT          NULL,
  last_message_at   DATETIME      NULL,
  next_action_at    DATETIME      NULL,
  internal_summary  TEXT          NULL,
  bot_state         VARCHAR(50)   NULL,
  -- initial | waiting_area | waiting_name | waiting_cpf | waiting_email | waiting_case | completed
  bot_collected_data JSON         NULL,
  assigned_user_id  INT UNSIGNED  NULL,
  lead_id           INT UNSIGNED  NULL,
  client_id         INT UNSIGNED  NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_wa_conv_phone (phone_number),
  INDEX idx_wa_conv_status        (status),
  INDEX idx_wa_conv_pipeline      (pipeline_stage),
  INDEX idx_wa_conv_assigned      (assigned_user_id),
  INDEX idx_wa_conv_lead          (lead_id),
  INDEX idx_wa_conv_client        (client_id),
  INDEX idx_wa_conv_last_msg      (last_message_at),

  CONSTRAINT fk_wa_conv_user   FOREIGN KEY (assigned_user_id) REFERENCES users(id)   ON DELETE SET NULL,
  CONSTRAINT fk_wa_conv_lead   FOREIGN KEY (lead_id)          REFERENCES leads(id)   ON DELETE SET NULL,
  CONSTRAINT fk_wa_conv_client FOREIGN KEY (client_id)        REFERENCES clients(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- whatsapp_messages — mensagens individuais
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id               INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  conversation_id  INT UNSIGNED  NOT NULL,
  direction        VARCHAR(10)   NOT NULL,
  -- incoming | outgoing
  message_type     VARCHAR(20)   NOT NULL DEFAULT 'text',
  -- text | image | audio | document
  content          TEXT          NOT NULL,
  media_url        VARCHAR(1000) NULL,
  transcription    TEXT          NULL,
  sent_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_wa_msg_conversation (conversation_id),
  INDEX idx_wa_msg_direction    (direction),
  INDEX idx_wa_msg_type         (message_type),
  INDEX idx_wa_msg_sent         (sent_at),

  CONSTRAINT fk_wa_msg_conversation FOREIGN KEY (conversation_id)
    REFERENCES whatsapp_conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- whatsapp_tags — etiquetas de conversas
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_tags (
  id    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name  VARCHAR(100) NOT NULL,
  color VARCHAR(20)  NOT NULL DEFAULT '#6366f1',

  UNIQUE KEY uq_wa_tag_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- whatsapp_conversation_tags — pivot tag ↔ conversa
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_conversation_tags (
  conversation_id INT UNSIGNED NOT NULL,
  tag_id          INT UNSIGNED NOT NULL,

  PRIMARY KEY (conversation_id, tag_id),

  CONSTRAINT fk_wa_ctag_conversation FOREIGN KEY (conversation_id)
    REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_wa_ctag_tag FOREIGN KEY (tag_id)
    REFERENCES whatsapp_tags(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────
-- whatsapp_internal_notes — notas internas por conversa
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_internal_notes (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id  INT UNSIGNED NOT NULL,
  user_id          INT UNSIGNED NOT NULL,
  note             TEXT         NOT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_wa_note_conversation (conversation_id),
  INDEX idx_wa_note_user         (user_id),

  CONSTRAINT fk_wa_note_conversation FOREIGN KEY (conversation_id)
    REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_wa_note_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
