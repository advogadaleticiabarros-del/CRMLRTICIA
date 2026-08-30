-- ============================================================
-- Migration 123 — Opt-in de newsletter na recusa de proposta
-- Quando uma proposta é marcada como 'recusada', o sistema manda uma
-- mensagem de WhatsApp com botões Sim/Não perguntando se a pessoa quer
-- continuar recebendo os informativos jurídicos do escritório
-- (ver src/routes/propostas.ts, PATCH /:id/status).
--
-- whatsapp_pending_replies — pendência genérica de "pergunta com botão
-- aguardando resposta por WhatsApp" (prefixo whatsapp_, mesmo padrão de
-- whatsapp_messages/whatsapp_media/whatsapp_chat_meta). Hoje só usada pelo
-- fluxo de newsletter (tipo='newsletter_opt_in'), mas o campo `tipo` deixa
-- aberto para outras perguntas de botão no futuro sem precisar de tabela nova.
-- expected_yes/expected_no guardam o id do botão que dispara cada resposta
-- (ver choices do /send/menu na Uazapi: "Sim|<id>"/"Não|<id>" — ao clicar,
-- o WhatsApp devolve o id como texto puro da resposta, não um campo
-- estruturado à parte — por isso o webhook casa por texto, com fallback
-- para "sim"/"não" digitado à mão).
-- Sem cron de expiração: uma pendência sem resposta em alguns dias fica
-- "sem resposta" no banco e nunca mais é usada (o webhook só considera
-- pendências dos últimos 7 dias — ver findOpenPendingReply).
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_pending_replies (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  phone         VARCHAR(20)  NOT NULL,
  tipo          VARCHAR(50)  NOT NULL DEFAULT 'newsletter_opt_in',
  lead_id       INT UNSIGNED NULL,
  client_id     INT UNSIGNED NULL,
  proposta_id   INT UNSIGNED NULL,
  expected_yes  VARCHAR(50)  NOT NULL,
  expected_no   VARCHAR(50)  NOT NULL,
  resposta      ENUM('sim','nao') NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at   DATETIME     NULL,
  INDEX idx_wpr_phone_open (phone, resolved_at),
  CONSTRAINT fk_wpr_lead     FOREIGN KEY (lead_id)     REFERENCES leads(id)     ON DELETE CASCADE,
  CONSTRAINT fk_wpr_client   FOREIGN KEY (client_id)   REFERENCES clients(id)   ON DELETE CASCADE,
  CONSTRAINT fk_wpr_proposta FOREIGN KEY (proposta_id) REFERENCES propostas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Proposta sem lead_id (cliente já convertido) não tem "status de funil" pra
-- marcar como newsletter — leads.status='newsletter' é conceito de LEAD.
-- Para cliente, o opt-in vira um campo simples na própria tabela clients.
ALTER TABLE clients
  ADD COLUMN newsletter_opt_in    TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN newsletter_opt_in_at DATETIME   NULL;
