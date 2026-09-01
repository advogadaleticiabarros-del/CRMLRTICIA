-- ============================================================
-- Migration 128 — Coluna "Proposta Recusada" no funil de Leads
-- Pedido da Dra. Letícia: quando o lead recusa a proposta, mover o card
-- pra essa coluna no Kanban e avisar a pessoa por WhatsApp automaticamente
-- (ver PATCH /api/leads/:id/status em src/routes/leads.ts).
--
-- Distinto de 'perdida' (motivo genérico de perda, ex.: sumiu, foi com
-- outro escritório) — 'proposta_recusada' é especificamente "mandamos
-- uma proposta e a resposta foi não", o único caso que dispara mensagem
-- automática hoje.
-- ============================================================

ALTER TABLE leads MODIFY COLUMN status
  ENUM('triagem','atendimento_inicial','reuniao','documentacao_pendente',
       'proposta','proposta_em_analise','proposta_recusada','contrato_assinado',
       'fechada','convertido','perdida','newsletter')
  NOT NULL DEFAULT 'triagem';
