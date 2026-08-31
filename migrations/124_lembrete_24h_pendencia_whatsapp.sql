-- ============================================================
-- Migration 124 — Lembrete de 24h pra pendência de WhatsApp sem resposta
-- Pedido da Dra. Letícia: se a pessoa não responder Sim/Não em até 24h
-- depois da pergunta (hoje só o opt-in de newsletter na recusa de proposta,
-- ver migration 123), o sistema manda UM lembrete reforçando a pergunta,
-- antes de desistir de vez na janela de 7 dias que já existia
-- (ver findOpenPendingReply em pendingWhatsappReplyService.ts — inalterada).
--
-- reminder_sent_at: marca SE e QUANDO o lembrete já foi mandado, pra o cron
-- de hora em hora (ver src/services/pendingWhatsappReminderService.ts) nunca
-- mandar duas vezes pra mesma pendência.
-- ============================================================

ALTER TABLE whatsapp_pending_replies
  ADD COLUMN reminder_sent_at DATETIME NULL AFTER resolved_at;
