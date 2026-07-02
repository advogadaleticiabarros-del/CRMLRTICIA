import { db } from '../config/database';
import { googleCalendarService } from './GoogleCalendarService';

interface SyncResult {
  created: number;
  updated: number;
  errors: number;
}

export class CalendarSyncService {
  async syncFromGoogle(userId: number): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0, errors: 0 };

    let events: any[];
    try {
      events = await googleCalendarService.listUpcomingEvents(userId, 100);
    } catch {
      result.errors++;
      return result;
    }

    for (const ev of events) {
      if (!ev.id || !ev.summary) continue;

      try {
        const start = ev.start?.dateTime ?? ev.start?.date;
        const end   = ev.end?.dateTime   ?? ev.end?.date;

        const [existing] = await db.query(
          'SELECT id FROM calendar_events WHERE google_event_id = ? AND user_id = ?',
          [ev.id, userId]
        ) as any;

        const videoLink = ev.conferenceData?.entryPoints?.find(
          (ep: any) => ep.entryPointType === 'video'
        )?.uri ?? null;

        if (existing.length) {
          await db.query(
            `UPDATE calendar_events
             SET title = ?, description = ?, start_datetime = ?, end_datetime = ?,
                 location = ?, video_link = ?, sync_status = 'sincronizado'
             WHERE google_event_id = ? AND user_id = ?`,
            [ev.summary, ev.description ?? null, start, end,
             ev.location ?? null, videoLink, ev.id, userId]
          );
          result.updated++;
        } else {
          // Detecta audiência pelo título — vira pendência para classificar (correspondente x cliente)
          const eventType = /audi[êe]ncia/i.test(ev.summary) ? 'audiencia' : 'compromisso';
          await db.query(
            `INSERT INTO calendar_events
               (user_id, google_event_id, title, description, event_type, start_datetime, end_datetime,
                location, video_link, source, sync_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'google', 'sincronizado')`,
            [userId, ev.id, ev.summary, ev.description ?? null, eventType,
             start, end, ev.location ?? null, videoLink]
          );
          result.created++;
        }
      } catch {
        result.errors++;
      }
    }

    return result;
  }

  /** Máximo de tentativas automáticas antes de parar de reprocessar um evento. */
  private static readonly MAX_ATTEMPTS = 8;

  async pushToGoogle(userId: number): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0, errors: 0 };

    // Reprocessa PENDENTES e também os que deram ERRO (até o limite de
    // tentativas). Assim uma falha transitória — token, rede, rate limit —
    // não trava o evento para sempre.
    const [pending] = await db.query(
      `SELECT * FROM calendar_events
       WHERE user_id = ? AND source = 'crm'
         AND sync_status IN ('pendente', 'erro')
         AND sync_attempts < ?
         AND start_datetime >= NOW()
       ORDER BY start_datetime ASC`,
      [userId, CalendarSyncService.MAX_ATTEMPTS]
    ) as any;

    for (const event of pending) {
      try {
        if (event.google_event_id) {
          await googleCalendarService.updateEvent(userId, event.google_event_id, {
            title: event.title,
            description: event.description,
            startDatetime: event.start_datetime,
            endDatetime: event.end_datetime,
          });
          result.updated++;
        } else {
          const { googleEventId, videoLink } = await googleCalendarService.createEvent(userId, {
            title: event.title,
            description: event.description,
            startDatetime: event.start_datetime,
            endDatetime: event.end_datetime,
            location: event.location,
            generateMeet: event.event_type === 'reuniao',
          });
          await db.query(
            'UPDATE calendar_events SET google_event_id = ?, video_link = ? WHERE id = ?',
            [googleEventId, videoLink ?? event.video_link, event.id]
          );
          result.created++;
        }

        await db.query(
          "UPDATE calendar_events SET sync_status = 'sincronizado', sync_error = NULL WHERE id = ?",
          [event.id]
        );
      } catch (e: any) {
        // Marca erro, conta a tentativa e guarda a mensagem — mas continua
        // elegível para novo retry na próxima rodada (até MAX_ATTEMPTS).
        await db.query(
          "UPDATE calendar_events SET sync_status = 'erro', sync_attempts = sync_attempts + 1, sync_error = ? WHERE id = ?",
          [String(e?.message || 'erro na sincronização').slice(0, 500), event.id]
        );
        result.errors++;
      }
    }

    return result;
  }

  async fullSync(userId: number): Promise<{ fromGoogle: SyncResult; toGoogle: SyncResult }> {
    const fromGoogle = await this.syncFromGoogle(userId);
    const toGoogle   = await this.pushToGoogle(userId);
    return { fromGoogle, toGoogle };
  }
}

export const calendarSyncService = new CalendarSyncService();
