import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../config/database';
import { env } from '../config/env';
import { googleCalendarService, statusToGoogleColorId } from '../services/GoogleCalendarService';
import { calendarSyncService } from '../services/CalendarSyncService';
import { notificationService } from '../services/NotificationService';
import { telegramNotificationService } from '../services/TelegramNotificationService';
import { localParaUtcMysql } from '../utils/timezone';

const router = Router();

// ── OAuth Google ──────────────────────────────────────────────────────────────

// GET /api/calendar/google/auth-url — gera URL com state assinado (carrega o user)
router.get('/google/auth-url', (req: Request, res: Response) => {
  if (!env.GOOGLE_CLIENT_ID) {
    res.status(503).json({ error: 'Integração Google não configurada no servidor' });
    return;
  }
  const state = jwt.sign({ id: (req as any).user.id }, env.JWT_SECRET, { expiresIn: '15m' });
  res.json({ url: googleCalendarService.getAuthUrl(state) });
});

// GET /api/calendar/google/status — conta conectada?
router.get('/google/status', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    'SELECT google_email, sync_enabled FROM google_accounts WHERE user_id = ?',
    [(req as any).user.id]
  ) as any;
  // Testa a conexão de verdade: o registro existir não basta — o Google pode
  // ter revogado a autorização (invalid_grant), como de 30/06 a 02/10/2026.
  let saudavel = rows.length > 0;
  let erro: string | null = null;
  if (rows.length) {
    try { await googleCalendarService.checarConexao((req as any).user.id); }
    catch (e: any) { saudavel = false; erro = e?.message || 'falha'; }
  }
  res.json({ connected: rows.length > 0, saudavel, erro, ...(rows[0] || {}) });
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
          location, client_id, case_id, task_id, deadline_id, generate_meet,
          repeat_daily, repeat_until } = req.body;

  if (!title || !start_datetime || !end_datetime) {
    res.status(400).json({ error: 'title, start_datetime e end_datetime são obrigatórios' });
    return;
  }

  // Regra única em services/agendaEventos (também usada pelo assistente do WhatsApp).
  const { criarEventoAgenda } = await import('../services/agendaEventos');
  const evento = await criarEventoAgenda(userId, {
    title, description, event_type, start_datetime, end_datetime, location, client_id, case_id,
    task_id, deadline_id, generate_meet, repeat_daily, repeat_until,
  });
  res.status(201).json(evento);
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

// ── GET /api/calendar/events/:id — detalhe de um evento ───────────────────────
router.get('/events/:id', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const [rows] = await db.query(
    `SELECT ce.*, cl.name AS client_name FROM calendar_events ce
     LEFT JOIN clients cl ON cl.id = ce.client_id
     WHERE ce.id = ? AND ce.user_id = ?`,
    [req.params.id, userId]
  ) as any;
  if (!rows.length) { res.status(404).json({ error: 'Evento não encontrado' }); return; }
  res.json(rows[0]);
});

// ── PATCH /api/calendar/events/:id/status — agendado/realizado/cancelado ──────
// Muda o status de negócio do compromisso e, se já existe no Google, atualiza
// a cor do evento por lá também (verde/vermelho/azul, pedido da cliente).
// Não usa a fila do cron (pushToGoogle só reprocessa eventos futuros) porque
// "realizado" normalmente é marcado DEPOIS que o compromisso já aconteceu —
// a atualização de cor precisa ir na hora, senão nunca seria reenviada.
const EVENT_STATUS = ['agendado', 'realizado', 'cancelado'];

router.patch('/events/:id/status', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { status } = req.body;
  if (!EVENT_STATUS.includes(status)) {
    res.status(400).json({ error: `status deve ser: ${EVENT_STATUS.join(', ')}` });
    return;
  }

  const [rows] = await db.query(
    'SELECT google_event_id FROM calendar_events WHERE id = ? AND user_id = ?',
    [req.params.id, userId]
  ) as any;
  if (!rows.length) { res.status(404).json({ error: 'Evento não encontrado' }); return; }

  await db.query(
    'UPDATE calendar_events SET status = ? WHERE id = ? AND user_id = ?',
    [status, req.params.id, userId]
  );

  const googleEventId = rows[0].google_event_id;
  if (googleEventId) {
    try {
      await googleCalendarService.updateEvent(userId, googleEventId, {
        colorId: statusToGoogleColorId(status),
      });
      await db.query("UPDATE calendar_events SET sync_status = 'sincronizado' WHERE id = ?", [req.params.id]);
    } catch (e: any) {
      // Status já foi salvo no CRM; a cor no Google fica pra próxima
      // sincronização (pushToGoogle não reprocessa isso automaticamente
      // pra eventos passados — marcamos erro pra visibilidade no admin).
      await db.query(
        "UPDATE calendar_events SET sync_status = 'erro', sync_error = ? WHERE id = ?",
        [String(e?.message || 'falha ao atualizar cor no Google').slice(0, 500), req.params.id]
      );
    }
  }

  res.json({ success: true, status });
});

// ── DELETE /api/calendar/events/:id — exclui (também no Google) ────────────────
router.delete('/events/:id', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const [rows] = await db.query(
    'SELECT google_event_id FROM calendar_events WHERE id = ? AND user_id = ?',
    [req.params.id, userId]
  ) as any;
  if (!rows.length) { res.status(404).json({ error: 'Evento não encontrado' }); return; }
  if (rows[0].google_event_id) {
    try { await googleCalendarService.deleteEvent(userId, rows[0].google_event_id); } catch { /* já removido no Google */ }
  }
  await db.query('DELETE FROM calendar_events WHERE id = ? AND user_id = ?', [req.params.id, userId]);
  res.json({ success: true });
});

// POST /api/calendar/events/:id/stop-series — encerra a repetição diária
// (a partir da original ou de qualquer ocorrência) e remove as futuras já geradas.
router.post('/events/:id/stop-series', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const [[ev]] = await db.query(
    'SELECT id, series_id FROM calendar_events WHERE id = ? AND user_id = ?', [req.params.id, userId]
  ) as any;
  if (!ev) { res.status(404).json({ error: 'Evento não encontrado' }); return; }
  const raiz = ev.series_id || ev.id;
  await db.query('UPDATE calendar_events SET repeat_daily = 0 WHERE id = ? AND user_id = ?', [raiz, userId]);
  const [futuras] = await db.query(
    'SELECT id, google_event_id FROM calendar_events WHERE series_id = ? AND user_id = ? AND start_datetime > UTC_TIMESTAMP()',
    [raiz, userId]
  ) as any;
  for (const f of futuras) {
    if (f.google_event_id) {
      try { await googleCalendarService.deleteEvent(userId, f.google_event_id); } catch { /* já removido no Google */ }
    }
    await db.query('DELETE FROM calendar_events WHERE id = ?', [f.id]);
  }
  res.json({ success: true });
});

// ── Sync manual ───────────────────────────────────────────────────────────────
router.post('/google/sync', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    // Sync manual destrava eventos que ficaram em erro e força novo envio.
    await db.query(
      "UPDATE calendar_events SET sync_status = 'pendente', sync_attempts = 0 WHERE user_id = ? AND source = 'crm' AND sync_status = 'erro' AND start_datetime >= NOW()",
      [userId]
    );
    const result = await calendarSyncService.fullSync(userId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
