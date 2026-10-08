import { db } from '../config/database';
import { googleCalendarService, statusToGoogleColorId } from './GoogleCalendarService';
import { notificationService } from './NotificationService';
import { telegramNotificationService } from './TelegramNotificationService';
import { localParaUtcMysql } from '../utils/timezone';

export interface NovoEvento {
  title: string; description?: string; event_type?: string | null;
  /** Hora local de Brasília, "AAAA-MM-DDTHH:MM". */
  start_datetime: string; end_datetime: string;
  location?: string; client_id?: number | null; case_id?: number | null;
  task_id?: number | null; deadline_id?: number | null; generate_meet?: boolean;
  repeat_daily?: boolean; repeat_until?: string | null;
}

/**
 * Cria um evento na agenda do usuário e, se a conta Google dele estiver
 * conectada, no Google Agenda (com lembrete no sino). Regra única da tela
 * (POST /api/calendar/events) e do assistente do WhatsApp. Movida de
 * routes/calendar.ts em 08/10/2026 sem mudar a lógica.
 */
export async function criarEventoAgenda(userId: number, ev: NovoEvento): Promise<any> {
  const { title, description, event_type, start_datetime, end_datetime, location, client_id, case_id,
    task_id, deadline_id, generate_meet, repeat_daily, repeat_until } = ev;
  const [result] = await db.query(
    `INSERT INTO calendar_events
       (user_id, client_id, case_id, task_id, deadline_id,
        title, description, event_type, start_datetime, end_datetime,
        location, source, sync_status, repeat_daily, repeat_until)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'crm', 'pendente', ?, ?)`,
    [userId, client_id ?? null, case_id ?? null, task_id ?? null, deadline_id ?? null,
     title, description ?? null, event_type ?? 'compromisso',
     localParaUtcMysql(start_datetime), localParaUtcMysql(end_datetime), location ?? null,
     repeat_daily ? 1 : 0, repeat_daily && repeat_until ? repeat_until : null]
  ) as any;

  const eventId = result.insertId;
  if (repeat_daily) {
    const { gerarOcorrenciasDiarias } = await import('../services/agendaPessoalJobs');
    await gerarOcorrenciasDiarias().catch(() => {});
  }

  // Sync to Google if connected
  const [ga] = await db.query('SELECT id FROM google_accounts WHERE user_id = ? AND sync_enabled = 1', [userId]) as any;
  if (ga.length) {
    try {
      const { googleEventId, videoLink } = await googleCalendarService.createEvent(userId, {
        title, description, startDatetime: start_datetime,
        endDatetime: end_datetime, location, generateMeet: generate_meet,
        colorId: statusToGoogleColorId('agendado'),
      });
      await db.query(
        "UPDATE calendar_events SET google_event_id = ?, video_link = ?, sync_status = 'sincronizado' WHERE id = ?",
        [googleEventId, videoLink ?? null, eventId]
      );

      // Send Telegram if meeting
      if (event_type === 'reuniao') {
        const [clients] = await db.query('SELECT name FROM clients WHERE id = ?', [client_id]) as any;
        await telegramNotificationService.sendReuniaoAgendada(userId, {
          clientName: clients[0]?.name ?? 'Cliente',
          dateTime: new Date(start_datetime).toLocaleString('pt-BR'),
        });
      }

      // Create reminder notification
      const settings = await notificationService.getSettings(userId);
      const reminderTime = new Date(new Date(start_datetime).getTime() - (settings?.reminder_minutes_before ?? 15) * 60_000);
      await notificationService.create({
        userId, calendarEventId: eventId,
        title: `Lembrete: ${title}`,
        message: `Começa em ${settings?.reminder_minutes_before ?? 15} minuto(s)`,
        notificationType: `${event_type}_lembrete`,
        channel: 'som',
        scheduledAt: reminderTime,
      });
    } catch {}
  }

  const [event] = await db.query('SELECT * FROM calendar_events WHERE id = ?', [eventId]) as any;
  return event[0];
}
