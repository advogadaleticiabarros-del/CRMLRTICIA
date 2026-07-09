import cron from 'node-cron';
import { db } from '../config/database';
import { deadlineCounterService } from '../services/DeadlineCounterService';
import { notificationService } from '../services/NotificationService';
import { calendarSyncService } from '../services/CalendarSyncService';
import { telegramNotificationService } from '../services/TelegramNotificationService';
import { runMonitoringJob, runDiscoveryJob } from '../services/monitoringService';
import { runBackup } from '../services/backupService';
import { sendMorningBriefings } from '../services/morningBriefingService';
import { captureDailyMetrics } from '../services/metricsSnapshotService';

export function startCronJobs() {
  // ── WhatsApp: reconecta a instância no boot se já houver sessão salva ─────
  setTimeout(() => {
    import('../services/waInstance').then((m) => m.startIfSession()).catch(() => {});
  }, 8000);

  // ── Resumo matinal por e-mail às 07:00 (horário de Brasília) ──────────────
  cron.schedule('0 7 * * *', async () => {
    try { await sendMorningBriefings(); } catch {}
  }, { timezone: 'America/Sao_Paulo' });

  // ── Retrato diário das métricas (sparklines) às 23:00 (Brasília) ──────────
  cron.schedule('0 23 * * *', async () => {
    try { await captureDailyMetrics(); } catch {}
  }, { timezone: 'America/Sao_Paulo' });
  // Garante o ponto de hoje logo após subir o servidor (não espera até 23h)
  setTimeout(() => { captureDailyMetrics().catch(() => {}); }, 12000);

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

  // ── a cada 10 min: sincroniza Google Calendar ─────────────────────────────
  cron.schedule('*/10 * * * *', async () => {
    try {
      const [users] = await db.query(
        'SELECT DISTINCT user_id FROM google_accounts WHERE sync_enabled = 1'
      ) as any;
      for (const u of users) {
        // Isola cada usuário: falha em um não impede a sync dos demais.
        try { await calendarSyncService.fullSync(u.user_id); } catch {}
      }
    } catch {}
  });

  // ── a cada 10 min: busca e-mails novos do parceiro (Infinity) no Gmail ────
  cron.schedule('*/10 * * * *', async () => {
    try {
      const { syncInboxNow } = await import('../services/partnerInboxService');
      await syncInboxNow(null);
    } catch {}
  });

  // ── sincronização completa diária às 06:00 (Brasília) ─────────────────────
  // Reconcilia nos dois sentidos: puxa o que mudou direto no app do Google
  // para o CRM e envia ao Google o que foi criado/alterado no CRM.
  cron.schedule('0 6 * * *', async () => {
    try {
      const [users] = await db.query(
        'SELECT DISTINCT user_id FROM google_accounts WHERE sync_enabled = 1'
      ) as any;
      let fromG = 0, toG = 0;
      for (const u of users) {
        const r = await calendarSyncService.fullSync(u.user_id);
        fromG += r.fromGoogle.created + r.fromGoogle.updated;
        toG   += r.toGoogle.created + r.toGoogle.updated;
      }
      console.log(`📅 Sync diária da agenda (06h): ${users.length} conta(s) · Google→CRM ${fromG} · CRM→Google ${toG}`);
    } catch (e: any) {
      console.error('❌ Falha na sync diária da agenda:', e.message);
    }
  }, { timezone: 'America/Sao_Paulo' });

  // ── diário 7h: prazos e cobranças vencidas ────────────────────────────────
  cron.schedule('0 7 * * *', async () => {
    try {
      await alertOverdueItems();
    } catch {}
  });

  // ── diário 08:30 (Brasília): régua de cobrança por e-mail (D-3, D0, D+3, D+7)
  cron.schedule('30 8 * * *', async () => {
    try {
      const { sendBillingReminders } = await import('../services/financeReminders');
      await sendBillingReminders();
    } catch {}
  }, { timezone: 'America/Sao_Paulo' });

  // ── a cada 6h: pagamentos "Já paguei" parados há 48h+ sem confirmação ─────
  cron.schedule('0 */6 * * *', async () => {
    try {
      const { alertStuckPayments } = await import('../services/financeReminders');
      await alertStuckPayments();
    } catch {}
  });

  // ── diário 07:15 (Brasília): prepara a fila de WhatsApp (cobrança/audiência)
  cron.schedule('15 7 * * *', async () => {
    try {
      const { generateWhatsappQueue } = await import('../services/whatsappQueue');
      await generateWhatsappQueue();
    } catch {}
  }, { timezone: 'America/Sao_Paulo' });

  // ── diário 09:00 (Brasília): conversas sem resposta do cliente há 7 dias ──
  cron.schedule('0 9 * * *', async () => {
    try {
      const { alertSilentChats } = await import('../services/whatsappQueue');
      await alertSilentChats();
    } catch {}
  }, { timezone: 'America/Sao_Paulo' });

  // ── segunda 08:00 (Brasília): resumo semanal por e-mail aos parceiros ──────
  cron.schedule('0 8 * * 1', async () => {
    try {
      const { sendPartnerWeeklyDigests } = await import('../services/partnerWeeklyDigest');
      await sendPartnerWeeklyDigests();
    } catch {}
  }, { timezone: 'America/Sao_Paulo' });

  // ── diário 07:10 (Brasília): audiências de casos de PARCERIA a 7 e 3 dias ──
  // Sino no CRM + e-mail ao parceiro com dados e orientações completas.
  cron.schedule('10 7 * * *', async () => {
    try {
      const { sendPartnerHearingAlerts } = await import('../services/partnerHearingAlerts');
      await sendPartnerHearingAlerts();
    } catch {}
  }, { timezone: 'America/Sao_Paulo' });

  // ── backup diário do banco: 02h (dump comprimido → MEGA) ──────────────────
  cron.schedule('0 2 * * *', async () => {
    try {
      const r = await runBackup();
      if (r.ok) console.log(`✅ Backup enviado ao MEGA: ${r.file} (${r.sizeKB} KB)`);
      else console.warn(`⚠️ Backup não realizado: ${r.message}`);
    } catch (e: any) {
      console.error('❌ Falha no backup diário:', e.message);
    }
  });

  // ── dia 1 do mês, 03h30: PROVA REAL do backup (restaura num banco temporário)
  // Falhou → alerta os admins no sino. Backup que não restaura não é backup.
  cron.schedule('30 3 1 * *', async () => {
    try {
      const { runRestoreCheckAndNotify } = await import('../services/restoreService');
      await runRestoreCheckAndNotify();
    } catch {}
    // Vigia do peso da mídia do WhatsApp no banco (entra no dump diário do MEGA):
    // acima de 400 MB, avisa os admins para decidir a retenção.
    try {
      const [[m]] = await db.query('SELECT COALESCE(SUM(LENGTH(data)),0) AS bytes, COUNT(*) AS n FROM whatsapp_media') as any;
      const mb = Math.round(Number(m.bytes) / 1048576);
      console.log(`📦 Mídia do WhatsApp no banco: ${m.n} arquivo(s) · ${mb} MB`);
      if (mb > 400) {
        const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
        for (const a of admins) {
          await db.query(
            `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
             VALUES (?, ?, ?, 'midia_grande', 'sistema', NOW(), 'pendente')`,
            [a.id, 'Mídia do WhatsApp ocupando muito espaço',
             `Os arquivos recebidos pelo WhatsApp somam ${mb} MB no banco (${m.n} arquivos) e engordam o backup diário. Considere migrar os antigos para o Drive ou definir uma retenção.`]);
        }
      }
    } catch {}
  }, { timezone: 'America/Sao_Paulo' });

  // ── descoberta por OAB: diário 06h (varre tribunais e cadastra novos) ─────
  cron.schedule('0 6 * * *', async () => {
    try {
      await runDiscoveryJob();
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
