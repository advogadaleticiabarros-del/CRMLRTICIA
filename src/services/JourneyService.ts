import { db } from '../config/database';

/**
 * Jornada unificada — registra TODO evento relevante do lead ao cliente/processo.
 * O registro NUNCA derruba a operação principal (engole erros).
 *
 * A fase de LEAD vive em `journey_log`; a fase CLIENTE/CASO já é registrada em
 * `client_timeline` (contratos, casos, movimentações). `getJourney` une as duas
 * para mostrar o histórico do início ao fim.
 */

export interface JourneyEntry {
  leadId?: number | null;
  clientId?: number | null;
  caseId?: number | null;
  actorId?: number | null;
  actorName?: string | null;
  eventType: string;
  title: string;
  description?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
}

export async function logActivity(e: JourneyEntry): Promise<void> {
  try {
    await db.query(
      `INSERT INTO journey_log
         (lead_id, client_id, case_id, actor_id, actor_name, event_type, title, description, old_value, new_value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.leadId ?? null, e.clientId ?? null, e.caseId ?? null,
        e.actorId ?? null, e.actorName ?? null,
        e.eventType, e.title, e.description ?? null, e.oldValue ?? null, e.newValue ?? null,
      ]
    );
  } catch (err) {
    console.error('Falha ao registrar jornada:', (err as Error).message);
  }
}

export interface JourneyItem {
  created_at: string;
  event_type: string;
  title: string;
  description: string | null;
  old_value: string | null;
  new_value: string | null;
  actor_name: string | null;
  source: 'funil' | 'cliente';
}

/** Histórico unificado de um lead e/ou cliente, em ordem cronológica. */
export async function getJourney(opts: { leadId?: number; clientId?: number }): Promise<JourneyItem[]> {
  let leadId = opts.leadId ?? null;
  let clientId = opts.clientId ?? null;

  // Resolve o vínculo: se veio leadId, descobre o cliente que ele virou (e vice-versa).
  if (leadId && !clientId) {
    const [[l]] = await db.query('SELECT client_id FROM leads WHERE id = ?', [leadId]) as any;
    clientId = l?.client_id ?? null;
  }

  // 1) Eventos da fase funil (journey_log) — lead, cliente e casos vinculados
  const jc: string[] = [];
  const jp: any[] = [];
  if (leadId) { jc.push('lead_id = ?'); jp.push(leadId); }
  if (clientId) {
    jc.push('client_id = ?'); jp.push(clientId);
    jc.push('lead_id IN (SELECT id FROM leads WHERE client_id = ?)'); jp.push(clientId);
    jc.push('case_id IN (SELECT id FROM cases WHERE client_id = ?)'); jp.push(clientId);
  }
  let journeyRows: any[] = [];
  if (jc.length) {
    const [r] = await db.query(
      `SELECT created_at, event_type, title, description, old_value, new_value, actor_name
         FROM journey_log WHERE ${jc.join(' OR ')}`, jp
    ) as any;
    journeyRows = r;
  }

  // 2) Eventos da fase cliente/caso (client_timeline já existente)
  let tlRows: any[] = [];
  if (clientId) {
    const [r] = await db.query(
      `SELECT t.created_at, t.event_type, t.description AS title,
              NULL AS description, NULL AS old_value, NULL AS new_value, u.name AS actor_name
         FROM client_timeline t
         LEFT JOIN users u ON u.id = t.created_by
        WHERE t.client_id = ?`, [clientId]
    ) as any;
    tlRows = r;
  }

  const all: JourneyItem[] = [
    ...journeyRows.map((x) => ({ ...x, source: 'funil' as const })),
    ...tlRows.map((x) => ({ ...x, source: 'cliente' as const })),
  ];
  all.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return all;
}
