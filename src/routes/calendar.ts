import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { googleCalendarService } from '../services/GoogleCalendarService';
import { calendarSyncService } from '../services/CalendarSyncService';
import { notificationService } from '../services/NotificationService';
import { telegramNotificationService } from '../services/TelegramNotificationService';

const router = Router();

// ── OAuth Google ──────────────────────────────────────────────────────────────

// GET /api/calendar/google/auth-url
router.get('/google/auth-url', (_req: Request, res: Response) => {
  const url = googleCalendarService.getAuthUrl();
  res.json({ url });
});

// GET /api/calendar/google/callback?code=...
router.get('/google/callback', async (req: Request, res: Response) => {
  const { code } = req.query;
  const userId = (req as any).user?.id;
  if (!code || !userId) {
    res.status(400).json({ error: 'Parâmetros inválidos' });
    return;
  }

  try {
    const tokens = await googleCalendarService.exchangeCode(String(code));

    // Get Google email
    const { google } = await import('googleapis');
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2.setCredentials({ access_token: tokens.access_token });
    const userInfo = google.oauth2({ version: 'v2', auth: oauth2 });
    const { data } = await userInfo.userinfo.get();

    await db.query(
      `INSERT INTO google_accounts (user_id, google_email, access_token, refresh_token, token_expiry, sync_enabled)
       VALUES (?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         google_email = VALUES(google_email),
         access_token = VALUES(access_token),
         refresh_token = VALUES(refresh_token),
         token_expiry = VALUES(token_expiry),
         sync_enabled = 1`,
      [userId, data.email, tokens.access_token, tokens.refresh_token, tokens.token_expiry]
    );

    // Sync immediately after connect
    await calendarSyncService.syncFromGoogle(userId);

    res.json({ success: true, google_email: data.email });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/calendar/google/disconnect
router.delete('/google/disconnect', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  await db.query('DELETE FROM google_accounts WHERE user_id = ?', [userId]);
  res.json({ success: true });
});

// ── Events CRUD ───────────────────────────────────────────────────────────────

// GET /api/calendar/events
router.get('/events', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { start, end, type, client_id } = req.query;

  let query = `
    SELECT ce.*, cl.name AS client_name
    FROM calendar_events ce
    LEFT JOIN clients cl ON cl.id = ce.client_id
    WHERE ce.user_id = ?
  `;
  const params: any[] = [userId];

  if (start)     { query += ' AND ce.start_datetime >= ?'; params.push(start); }
  if (end)       { query += ' AND ce.end_datetime <= ?';   params.push(end); }
  if (type)      { query += ' AND ce.event_type = ?';      params.push(type); }
  if (client_id) { query += ' AND ce.client_id = ?';       params.push(client_id); }

  query += ' ORDER BY ce.start_datetime ASC';

  const [rows] = await db.query(query, params) as any;
  res.json(rows);
});

// POST /api/calendar/events
router.post('/events', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { title, description, event_type, start_datetime, end_datetime,
          location, client_id, case_id, task_id, deadline_id, generate_meet } = req.body;

  if (!title || !start_datetime || !end_datetime) {
    res.status(400).json({ error: 'title, start_datetime e end_datetime são obrigatórios' });
    return;
  }

  const [result] = await db.query(
    `INSERT INTO calendar_events
       (user_id, client_id, case_id, task_id, deadline_id,
        title, description, event_type, start_datetime, end_datetime,
        location, source, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'crm', 'pendente')`,
    [userId, client_id ?? null, case_id ?? null, task_id ?? null, deadline_id ?? null,
     title, description ?? null, event_type ?? 'compromisso', start_datetime, end_datetime, location ?? null]
  ) as any;

  const eventId = result.insertId;

  // Sync to Google if connected
  const [ga] = await db.query('SELECT id FROM google_accounts WHERE user_id = ? AND sync_enabled = 1', [userId]) as any;
  if (ga.length) {
    try {
      const { googleEventId, videoLink } = await googleCalendarService.createEvent(userId, {
        title, description, startDatetime: new Date(start_datetime),
        endDatetime: new Date(end_datetime), location, generateMeet: generate_meet,
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
  res.status(201).json(event[0]);
});

// ── GET /api/calendar/feed?start=&end= — agenda unificada ──────────────────────
// Reúne eventos, reuniões, audiências, prazos e tarefas no mesmo período.
router.get('/feed', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const start = (req.query.start as string) || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const end   = (req.query.end as string)   || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString();

  const [events] = await db.query(
    `SELECT ce.id, ce.title, ce.event_type AS type, ce.start_datetime AS datetime,
            ce.video_link, ce.location, cl.name AS client_name, NULL AS status_label
     FROM calendar_events ce
     LEFT JOIN clients cl ON cl.id = ce.client_id
     WHERE ce.user_id = ? AND ce.start_datetime BETWEEN ? AND ?`,
    [userId, start, end]
  ) as any;

  const [deadlines] = await db.query(
    `SELECT d.id, d.description AS title, 'prazo' AS type, d.deadline_date AS datetime,
            NULL AS video_link, NULL AS location, cl.name AS client_name,
            CASE
              WHEN d.status <> 'pendente' THEN d.status
              WHEN d.deadline_date < NOW() THEN 'vencido'
              WHEN TIMESTAMPDIFF(HOUR, NOW(), d.deadline_date) <= 24 THEN 'urgente'
              WHEN TIMESTAMPDIFF(DAY, NOW(), d.deadline_date) <= 3 THEN 'atencao'
              ELSE 'normal'
            END AS status_label
     FROM deadlines d
     LEFT JOIN cases c ON c.id = d.case_id
     LEFT JOIN clients cl ON cl.id = c.client_id
     WHERE d.user_id = ? AND d.status = 'pendente' AND d.deadline_date BETWEEN ? AND ?`,
    [userId, start, end]
  ) as any;

  const [tasks] = await db.query(
    `SELECT t.id, t.title, 'tarefa' AS type, t.due_date AS datetime,
            NULL AS video_link, NULL AS location, cl.name AS client_name,
            CASE
              WHEN t.due_date < NOW() THEN 'vencido'
              WHEN TIMESTAMPDIFF(HOUR, NOW(), t.due_date) <= 24 THEN 'urgente'
              WHEN TIMESTAMPDIFF(DAY, NOW(), t.due_date) <= 3 THEN 'atencao'
              ELSE 'normal'
            END AS status_label
     FROM tasks t
     LEFT JOIN clients cl ON cl.id = t.client_id
     WHERE t.user_id = ? AND t.status NOT IN ('concluida','cancelada')
       AND t.due_date IS NOT NULL AND t.due_date BETWEEN ? AND ?`,
    [userId, start, end]
  ) as any;

  const all = [...events, ...deadlines, ...tasks].sort(
    (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
  );
  res.json(all);
});

// ── Sync manual ───────────────────────────────────────────────────────────────
router.post('/google/sync', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    const result = await calendarSyncService.fullSync(userId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
