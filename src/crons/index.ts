import cron from 'node-cron';
import { db } from '../config/database';
import { deadlineCounterService } from '../services/DeadlineCounterService';
import { notificationService } from '../services/NotificationService';
import { calendarSyncService } from '../services/CalendarSyncService';
import { telegramNotificationService } from '../services/TelegramNotificationService';
import { runMonitoringJob } from '../services/monitoringService';

export function startCronJobs() {
  // ── a cada 5 min: atualiza contadores de prazos ──────────────────────────
  cron.schedule('*/5 * * * *', async () => {
    try {
      await deadlineCounterService.updateAllCounters();
    } catch {}
  });

  // ── a cada 5 min: despacha notificações pendentes ────────────────────────
  cron.schedule('*/5 * * * *', async () => {
    try {
      const pending = await notificationService.getPending();
      for (const n of pending) {
        await notificationService.dispatch(n);
      }
    } catch {}
  });

  // ── a cada hora: gera alertas de prazos próximos ─────────────────────────
  cron.schedule('0 * * * *', async () => {
    try {
      await generateDeadlineAlerts();
    } catch {}
  });

  // ── a cada 15 min: alerta reuniões e audiências próximas ─────────────────
  cron.schedule('*/15 * * * *', async () => {
    try {
      await alertUpcomingEvents();
    } catch {}
  });

  // ── a cada 30 min: sincroniza Google Calendar ─────────────────────────────
  cron.schedule('*/30 * * * *', async () => {
    try {
      const [users] = await db.query(
        'SELECT DISTINCT user_id FROM google_accounts WHERE sync_enabled = 1'
      ) as any;
      for (const u of users) {
        await calendarSyncService.fullSync(u.user_id);
      }
    } catch {}
  });

  // ── diário 7h: prazos e cobranças vencidas ────────────────────────────────
  cron.schedule('0 7 * * *', async () => {
    try {
      await alertOverdueItems();
    } catch {}
  });

  // ── monitoramento processual: 08h e 16h (DataJud/provider ativo) ──────────
  cron.schedule('0 8,16 * * *', async () => {
    try {
      await runMonitoringJob();
    } catch {}
  });

  // ── a cada hora: proposta em análise há 7+ dias → perdida (inativa) ────────
  cron.schedule('30 * * * *', async () => {
    try {
      await db.query(`
        UPDATE leads
        SET status = 'perdida', analise_since = NULL
        WHERE status = 'proposta_em_analise'
          AND analise_since IS NOT NULL
          AND analise_since < (NOW() - INTERVAL 7 DAY)
      `);
    } catch {}
  });
}

/** Roda todas as checagens de notificação imediatamente (usado pelo botão "verificar agora"). */
export async function runNotificationChecks(): Promise<{ generated: number; dispatched: number }> {
  await deadlineCounterService.updateAllCounters();
  await generateDeadlineAlerts();
  await alertUpcomingEvents();
  const pending = await notificationService.getPending();
  for (const n of pending) {
    await notificationService.dispatch(n);
  }
  return { generated: pending.length, dispatched: pending.length };
}

async function generateDeadlineAlerts() {
  const [deadlines] = await db.query(`
    SELECT d.id, d.description, d.deadline_date, d.user_id,
           c.case_number, ns.reminder_minutes_before, ts.enabled AS telegram_enabled
    FROM deadlines d
    JOIN cases c ON c.id = d.case_id
    JOIN notification_settings ns ON ns.user_id = d.user_id
    LEFT JOIN telegram_settings ts ON ts.user_id = d.user_id
    WHERE d.status = 'pendente'
      AND d.deadline_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 3 DAY)
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.deadline_id = d.id AND n.status IN ('pendente','enviada')
          AND n.scheduled_at >= NOW() - INTERVAL 1 HOUR
      )
  `) as any;

  for (const d of deadlines) {
    const daysLeft = Math.ceil(
      (new Date(d.deadline_date).getTime() - Date.now()) / 86_400_000
    );
    await notificationService.create({
      userId:      d.user_id,
      deadlineId:  d.id,
      title:       `Prazo processual em ${daysLeft} dia(s)`,
      message:     `${d.description} — Processo ${d.case_number}`,
      notificationType: 'prazo_proximo',
      channel:     'sistema',
      scheduledAt: new Date(),
    });

    if (d.telegram_enabled) {
      await telegramNotificationService.sendPrazoProcessual(d.user_id, {
        caseRef: d.case_number,
        daysLeft,
      });
    }
  }
}

async function alertUpcomingEvents() {
  const [events] = await db.query(`
    SELECT ce.id, ce.title, ce.event_type, ce.start_datetime, ce.user_id,
           cl.name AS client_name, ts.enabled AS telegram_enabled,
           ns.reminder_minutes_before
    FROM calendar_events ce
    JOIN notification_settings ns ON ns.user_id = ce.user_id
    LEFT JOIN clients cl ON cl.id = ce.client_id
    LEFT JOIN telegram_settings ts ON ts.user_id = ce.user_id
    WHERE ce.event_type IN ('reuniao', 'audiencia')
      AND ce.start_datetime BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 65 MINUTE)
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.calendar_event_id = ce.id AND n.notification_type LIKE '%proxima%'
          AND n.created_at >= NOW() - INTERVAL 70 MINUTE
      )
  `) as any;

  for (const ev of events) {
    const minutesLeft = Math.round(
      (new Date(ev.start_datetime).getTime() - Date.now()) / 60_000
    );
    await notificationService.create({
      userId:          ev.user_id,
      calendarEventId: ev.id,
      title:           `${ev.event_type === 'audiencia' ? 'Audiência' : 'Reunião'} em ${minutesLeft} min`,
      message:         `${ev.title}${ev.client_name ? ` — ${ev.client_name}` : ''}`,
      notificationType: `${ev.event_type}_proxima`,
      channel:         'som',
      scheduledAt:     new Date(),
    });

    if (ev.telegram_enabled) {
      if (ev.event_type === 'reuniao') {
        await telegramNotificationService.sendReuniaoProxima(ev.user_id, {
          clientName: ev.client_name ?? ev.title,
          minutesLeft,
        });
      } else {
        await telegramNotificationService.sendAudienciaProxima(ev.user_id, {
          caseRef: ev.title,
          minutesLeft,
        });
      }
    }
  }
}

async function alertOverdueItems() {
  // Cobranças vencidas
  const [cobrancas] = await db.query(`
    SELECT fr.id, fr.valor, fr.user_id, cl.name AS client_name, ts.enabled AS telegram_enabled
    FROM financial_records fr
    JOIN clients cl ON cl.id = fr.client_id
    LEFT JOIN telegram_settings ts ON ts.user_id = fr.user_id
    WHERE fr.tipo = 'receita' AND fr.status = 'pendente'
      AND fr.due_date < CURDATE()
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.notification_type = 'cobranca_vencida'
          AND n.client_id = fr.client_id AND DATE(n.created_at) = CURDATE()
      )
  `) as any;

  for (const c of cobrancas) {
    if (c.telegram_enabled) {
      await telegramNotificationService.sendCobrancaVencida(c.user_id, {
        clientName: c.client_name,
        value: Number(c.valor).toFixed(2),
      });
    }
  }
}
