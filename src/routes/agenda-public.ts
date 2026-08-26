// src/routes/agenda-public.ts
import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { localParaUtcMysql } from '../utils/timezone';
import { calcularSlotsDisponiveis, parseExpedienteDeOfficeSettings, IntervaloEvento } from '../services/agendaSlots';
import { googleCalendarService } from '../services/GoogleCalendarService';
import { telegramNotificationService } from '../services/TelegramNotificationService';
import { notificationService } from '../services/NotificationService';
import { notifyNewLead } from '../services/leadAlert';

const router = Router();

async function agendaAtiva(): Promise<boolean> {
  const [[row]] = await db.query(
    "SELECT setting_value FROM office_settings WHERE setting_key = 'agenda_self_service_ativo'"
  ) as any;
  return row?.setting_value === '1';
}

async function buscarExpediente() {
  const [rows] = await db.query(
    `SELECT setting_key, setting_value FROM office_settings
     WHERE setting_key IN ('agenda_dias_semana','agenda_hora_inicio','agenda_hora_fim','agenda_duracao_consulta_min')`
  ) as any;
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.setting_key] = r.setting_value || '';
  return parseExpedienteDeOfficeSettings(settings);
}

// Converte start_datetime/end_datetime de calendar_events (o driver mysql2
// devolve DATETIME como objeto Date — src/config/database.ts usa
// dateStrings:false — nunca como string) para string local Brasília
// "YYYY-MM-DDTHH:MM", mesma convenção de entrada/saída de
// calcularSlotsDisponiveis. Não existe utilitário pronto para esta direção
// no projeto (só localParaUtcMysql, que é o sentido oposto) — implementado
// aqui, escopo local à rota de agenda.
export function utcParaLocalStr(v: Date): string {
  const localMs = v.getTime() - 3 * 60 * 60 * 1000; // Brasília = UTC-3, fixo
  const local = new Date(localMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

async function buscarEventosExistentes(dataInicioStr: string, dataFimStr: string): Promise<IntervaloEvento[]> {
  const [rows] = await db.query(
    `SELECT start_datetime, end_datetime FROM calendar_events
     WHERE start_datetime < ? AND end_datetime > ?`,
    [`${dataFimStr} 23:59:59`, `${dataInicioStr} 00:00:00`]
  ) as any;
  return rows.map((r: any) => ({
    start_datetime: utcParaLocalStr(r.start_datetime),
    end_datetime: utcParaLocalStr(r.end_datetime),
  }));
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function hojeStrBrasilia(): string {
  // "Hoje" em Brasília, não em UTC — evita virar o dia errado perto da
  // meia-noite (mesmo cuidado de fuso do resto deste arquivo).
  const nowUtc = new Date();
  const localMs = nowUtc.getTime() - 3 * 60 * 60 * 1000;
  return new Date(localMs).toISOString().slice(0, 10);
}

// ── GET /api/public/agenda/slots?dias=14 — horários livres ──────────────────
router.options('/agenda/slots', (_req: Request, res: Response) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.sendStatus(204);
});

router.get('/agenda/slots', async (req: Request, res: Response) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (!(await agendaAtiva())) { res.status(503).json({ error: 'Agendamento online indisponível no momento' }); return; }

  const diasQ = parseInt(String(req.query.dias || '14'), 10);
  const dias = Number.isFinite(diasQ) && diasQ > 0 ? Math.min(diasQ, 30) : 14;

  const dataInicioStr = hojeStrBrasilia();
  const dataFimStr = addDaysToDateStr(dataInicioStr, dias - 1);

  const expediente = await buscarExpediente();
  const eventosExistentes = await buscarEventosExistentes(dataInicioStr, dataFimStr);
  const slots = calcularSlotsDisponiveis(expediente, eventosExistentes, dataInicioStr, dataFimStr);

  res.json({ slots });
});

// ── POST /api/public/agenda/agendar — cria o agendamento ────────────────────
// Mesmo padrão anti-spam de lead-public.ts: honeypot (website) + rate-limit
// por IP (5/15min). Map local — não compartilhado com outros arquivos.
const WINDOW_MS = 15 * 60 * 1000;
const hits = new Map<string, { count: number; first: number }>();
function tooMany(ip: string): boolean {
  const h = hits.get(ip);
  if (!h || Date.now() - h.first > WINDOW_MS) { hits.set(ip, { count: 1, first: Date.now() }); return false; }
  h.count++;
  if (hits.size > 5000) hits.clear();
  return h.count > 5;
}

router.options('/agenda/agendar', (_req: Request, res: Response) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.sendStatus(204);
});

router.post('/agenda/agendar', async (req: Request, res: Response) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (!(await agendaAtiva())) { res.status(503).json({ error: 'Agendamento online indisponível no momento' }); return; }

  const b = req.body || {};
  if (b.website) { res.json({ success: true }); return; } // honeypot: bot preencheu — finge sucesso
  if (tooMany(req.ip || 'ip')) { res.status(429).json({ error: 'Muitos envios — tente mais tarde' }); return; }

  const name = String(b.name || '').trim();
  if (name.length < 3) { res.status(400).json({ error: 'Informe seu nome' }); return; }
  const phone = String(b.phone || '').replace(/\D/g, '').slice(0, 15);
  if (!phone) { res.status(400).json({ error: 'Informe seu telefone' }); return; }
  const email = String(b.email || '').trim().slice(0, 255) || null;
  const message = String(b.message || '').trim().slice(0, 2000) || null;
  const startDatetime = String(b.start_datetime || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startDatetime)) {
    res.status(400).json({ error: 'Horário inválido' });
    return;
  }

  // Mesma janela que GET /slots publica (hoje..hoje+29) — sem isso, um
  // start_datetime bem-formado mas arbitrário (passado ou distante) passava
  // pela revalidação, já que ela só recalcula o dia pedido, não valida se
  // esse dia está dentro do intervalo divulgado.
  const hoje = hojeStrBrasilia();
  const dataStr = startDatetime.slice(0, 10);
  if (dataStr < hoje || dataStr > addDaysToDateStr(hoje, 29)) {
    res.status(400).json({ error: 'Horário inválido' });
    return;
  }

  const expediente = await buscarExpediente();
  const endDatetime = (() => {
    const [datePart, timePart] = startDatetime.split('T');
    const [h, m] = timePart.split(':').map(Number);
    const totalMin = h * 60 + m + expediente.duracaoConsultaMin;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${datePart}T${pad(Math.floor(totalMin / 60))}:${pad(totalMin % 60)}`;
  })();

  // Revalida no servidor: o slot pedido precisa aparecer na lista recalculada agora.
  const eventosExistentes = await buscarEventosExistentes(dataStr, dataStr);
  const slotsDoDia = calcularSlotsDisponiveis(expediente, eventosExistentes, dataStr, dataStr);
  const aindaLivre = slotsDoDia.some((s) => s.start_datetime === startDatetime && s.end_datetime === endDatetime);
  if (!aindaLivre) { res.status(409).json({ error: 'Esse horário acabou de ser ocupado — escolha outro' }); return; }

  const [[admin]] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1") as any;
  if (!admin) { res.status(500).json({ error: 'Indisponível' }); return; }

  // Dedupe de 24h por telefone/e-mail — mesmo padrão de lead-public.ts.
  const [[dup]] = await db.query(
    `SELECT id FROM leads WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
       AND ((? IS NOT NULL AND phone = ?) OR (? IS NOT NULL AND email = ?)) LIMIT 1`,
    [phone, phone, email, email]
  ) as any;

  let leadId: number;
  if (dup) {
    leadId = dup.id;
    await db.query(
      'UPDATE leads SET case_summary = CONCAT(COALESCE(case_summary,\'\'), \'\n---\n\', ?) WHERE id = ?',
      [`Agendou consulta pelo site para ${startDatetime.replace('T', ' ')}.${message ? ' Motivo: ' + message : ''}`, leadId]
    ).catch(() => {});
  } else {
    const [ins] = await db.query(
      `INSERT INTO leads (user_id, name, phone, email, source, legal_area, status, case_summary)
       VALUES (?, ?, ?, ?, 'agendamento_site', NULL, 'triagem', ?)`,
      [admin.id, name, phone, email, message ? `Agendou consulta pelo site.\nMotivo: ${message}` : 'Agendou consulta pelo site.']
    ) as any;
    leadId = ins.insertId;
  }

  const title = `Consulta — ${name}`;
  const [result] = await db.query(
    `INSERT INTO calendar_events
       (user_id, title, description, event_type, start_datetime, end_datetime, source, sync_status)
     VALUES (?, ?, ?, 'reuniao', ?, ?, 'crm', 'pendente')`,
    [admin.id, title, message, localParaUtcMysql(startDatetime), localParaUtcMysql(endDatetime)]
  ) as any;
  const eventId = result.insertId;

  // Sync Google + Telegram + lembrete — mesma lógica de POST /api/calendar/events
  // (src/routes/calendar.ts:91-124), best-effort: falha aqui nunca derruba o
  // agendamento em si (lead e evento já estão gravados no CRM).
  const [ga] = await db.query('SELECT id FROM google_accounts WHERE user_id = ? AND sync_enabled = 1', [admin.id]) as any;
  if (ga.length) {
    try {
      const { googleEventId, videoLink } = await googleCalendarService.createEvent(admin.id, {
        title, description: message ?? undefined, startDatetime, endDatetime,
      });
      await db.query(
        "UPDATE calendar_events SET google_event_id = ?, video_link = ?, sync_status = 'sincronizado' WHERE id = ?",
        [googleEventId, videoLink ?? null, eventId]
      );

      await telegramNotificationService.sendReuniaoAgendada(admin.id, {
        clientName: name,
        dateTime: new Date(localParaUtcMysql(startDatetime).replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      });

      const settings = await notificationService.getSettings(admin.id);
      const reminderTime = new Date(new Date(localParaUtcMysql(startDatetime).replace(' ', 'T') + 'Z').getTime() - (settings?.reminder_minutes_before ?? 15) * 60_000);
      await notificationService.create({
        userId: admin.id, calendarEventId: eventId,
        title: `Lembrete: ${title}`,
        message: `Começa em ${settings?.reminder_minutes_before ?? 15} minuto(s)`,
        notificationType: 'reuniao_lembrete',
        channel: 'som',
        scheduledAt: reminderTime,
      });
    } catch { /* best-effort — mesmo padrão de calendar.ts:124 */ }
  }

  await notifyNewLead({ leadId, name, phone, source: 'Agendamento site', area: null, message: message || 'Agendou consulta pelo site' }).catch(() => {});

  res.status(201).json({ success: true });
});

export default router;
