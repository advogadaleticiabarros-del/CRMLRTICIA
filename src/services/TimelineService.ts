import { db } from '../config/database';

interface TimelineEvent {
  clientId: number;
  caseId?: number | null;
  contractId?: number | null;
  eventType: string;
  description: string;
  userId?: number | null;
}

/** Registra um evento no histórico (linha do tempo) do cliente. */
export async function logTimeline(ev: TimelineEvent): Promise<void> {
  if (!ev.clientId) return;
  await db.query(
    `INSERT INTO client_timeline (client_id, case_id, contract_id, event_type, description, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [ev.clientId, ev.caseId ?? null, ev.contractId ?? null, ev.eventType, ev.description, ev.userId ?? null]
  );
}
