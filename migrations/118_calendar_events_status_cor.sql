-- ============================================================
-- Migration 118 — Status de negócio em calendar_events, para
-- colorir o evento no Google Calendar (verde/vermelho/azul).
--
-- calendar_events já tinha `sync_status` (pendente/sincronizado/erro),
-- mas isso é status do MECANISMO de sincronização, não do compromisso
-- em si. Faltava um status de negócio (agendado/realizado/cancelado)
-- para decidir a cor enviada ao Google.
--
-- Só 3 estados, como a cliente pediu (verde=realizado, vermelho=
-- cancelado, azul=agendado). "Adiado" não vira estado novo: um
-- compromisso adiado continua "agendado" (a nova data já reflete isso
-- em start_datetime/end_datetime) — dative_hearings, que já tem
-- 'adiada' no seu próprio enum, é tabela separada e não foi alterada.
-- ============================================================

ALTER TABLE calendar_events
  ADD COLUMN status ENUM('agendado','realizado','cancelado') NOT NULL DEFAULT 'agendado' AFTER sync_status,
  ADD INDEX idx_calendar_events_status (status);
