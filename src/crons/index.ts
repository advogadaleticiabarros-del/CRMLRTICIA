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
import { runJob } from './runner';

/**
 * Rotinas automáticas do CRM.
 *
 * Todas passam pelo `runJob`: a falha NÃO derruba o servidor (comportamento
 * mantido), mas agora aparece no log, fica registrada em `job_runs` e avisa os
 * admins no sino. Antes usávamos `catch {}` — o erro sumia em silêncio.
 *
 * `critica: true` = prazos, backup e financeiro (falha aqui gera dano real).
 */
export function startCronJobs() {
  // ── WhatsApp: reconecta a instância no boot se já houver sessão salva ─────
  setTimeout(() => {
    runJob('whatsapp:reconectar', async () => {
      const m = await import('../services/waInstance');
      await m.startIfSession();
    });
  }, 8000);

  // ── Resumo matinal por e-mail às 07:00 (horário de Brasília) ──────────────
  cron.schedule('0 7 * * *', () => {
    runJob('briefing:matinal', () => sendMorningBriefings());
  }, { timezone: 'America/Sao_Paulo' });

  // ── Retrato diário das métricas (sparklines) às 23:00 (Brasília) ──────────
  cron.schedule('0 23 * * *', () => {
    runJob('metricas:retrato-diario', () => captureDailyMetrics());
  }, { timezone: 'America/Sao_Paulo' });
  // Garante o ponto de hoje logo após subir o servidor (não espera até 23h)
  setTimeout(() => { runJob('metricas:retrato-boot', () => captureDailyMetrics(), { silencioso: true }); }, 12000);

  // ── a cada 5 min: atualiza contadores de prazos ── CRÍTICO ────────────────
  cron.schedule('*/5 * * * *', () => {
    runJob('prazos:contadores', () => deadlineCounterService.updateAllCounters(),
      { critica: true, silencioso: true });
  });

  // ── a cada 5 min: despacha notificações pendentes ── CRÍTICO ──────────────
  cron.schedule('*/5 * * * *', () => {
    runJob('notificacoes:despachar', async () => {
      const pending = await notificationService.getPending();
      for (const n of pending) await notificationService.dispatch(n);
      return { despachadas: pending.length };
    }, { critica: true, silencioso: true });
  });

  // ── a cada hora: gera alertas de prazos próximos ── CRÍTICO ───────────────
  cron.schedule('0 * * * *', () => {
    runJob('prazos:alertas', () => generateDeadlineAlerts(), { critica: true });
  });

  // ── a cada 15 min: alerta reuniões e audiências próximas ── CRÍTICO ───────
  cron.schedule('*/15 * * * *', () => {
    runJob('agenda:eventos-proximos', () => alertUpcomingEvents(),
      { critica: true, silencioso: true });
  });

  // ── a cada 10 min: sincroniza Google Calendar ─────────────────────────────
  cron.schedule('*/10 * * * *', () => {
    runJob('agenda:sync-incremental', async () => {
      const [users] = await db.query(
        'SELECT DISTINCT user_id FROM google_accounts WHERE sync_enabled = 1'
      ) as any;
      const falhas: string[] = [];
      for (const u of users) {
        // Isola cada usuário: falha em um não impede a sync dos demais — mas registra.
        try { await calendarSyncService.fullSync(u.user_id); }
        catch (e: any) { falhas.push(`user ${u.user_id}: ${e?.message || e}`); }
      }
      if (falhas.length) throw new Error(`${falhas.length} conta(s) falharam · ${falhas.join(' | ')}`);
      return { contas: users.length };
    }, { silencioso: true });
  });

  // ── a cada 10 min: busca e-mails novos do parceiro (Infinity) no Gmail ────
  cron.schedule('*/10 * * * *', () => {
    runJob('parceria:sync-gmail', async () => {
      const { syncInboxNow } = await import('../services/partnerInboxService');
      return await syncInboxNow(null);
    }, { silencioso: true });
  });

  // ── sincronização completa diária às 06:00 (Brasília) ─────────────────────
  cron.schedule('0 6 * * *', () => {
    runJob('agenda:sync-completa', async () => {
      const [users] = await db.query(
        'SELECT DISTINCT user_id FROM google_accounts WHERE sync_enabled = 1'
      ) as any;
      let fromG = 0, toG = 0;
      for (const u of users) {
        const r = await calendarSyncService.fullSync(u.user_id);
        fromG += r.fromGoogle.created + r.fromGoogle.updated;
        toG   += r.toGoogle.created + r.toGoogle.updated;
      }
      return { contas: users.length, googleParaCrm: fromG, crmParaGoogle: toG };
    });
  }, { timezone: 'America/Sao_Paulo' });

  // ── diário 7h: prazos e cobranças vencidas ── CRÍTICO ─────────────────────
  cron.schedule('0 7 * * *', () => {
    runJob('financeiro:vencidos', () => alertOverdueItems(), { critica: true });
  });

  // ── diário 08:30: régua de cobrança por e-mail (D-3, D0, D+3, D+7) ── CRÍTICO
  cron.schedule('30 8 * * *', () => {
    runJob('financeiro:regua-cobranca', async () => {
      const { sendBillingReminders } = await import('../services/financeReminders');
      return await sendBillingReminders();
    }, { critica: true });
  }, { timezone: 'America/Sao_Paulo' });

  // ── diário 00:40: gera despesas/receitas RECORRENTES do dia ── CRÍTICO ────
  cron.schedule('40 0 * * *', () => {
    runJob('financeiro:recorrentes', async () => {
      const { generateRecurringRecords } = await import('../services/financeReminders');
      return await generateRecurringRecords();
    }, { critica: true });
  }, { timezone: 'America/Sao_Paulo' });
  // Também roda 30s após subir (não perde o ciclo se o deploy cair no horário)
  setTimeout(() => {
    runJob('financeiro:recorrentes-boot', async () => {
      const m = await import('../services/financeReminders');
      return await m.generateRecurringRecords();
    }, { critica: true, silencioso: true });
  }, 30000);

  // ── a cada 6h: pagamentos "Já paguei" parados há 48h+ sem confirmação ─────
  cron.schedule('0 */6 * * *', () => {
    runJob('financeiro:pagamentos-parados', async () => {
      const { alertStuckPayments } = await import('../services/financeReminders');
      return await alertStuckPayments();
    }, { critica: true });
  });

  // ── diário 07:15: prepara a fila de WhatsApp (cobrança/audiência) ─────────
  cron.schedule('15 7 * * *', () => {
    runJob('whatsapp:fila', async () => {
      const { generateWhatsappQueue } = await import('../services/whatsappQueue');
      return await generateWhatsappQueue();
    });
  }, { timezone: 'America/Sao_Paulo' });

  // ── diário 09:00: conversas sem resposta do cliente há 7 dias ─────────────
  cron.schedule('0 9 * * *', () => {
    runJob('whatsapp:conversas-paradas', async () => {
      const { alertSilentChats } = await import('../services/whatsappQueue');
      return await alertSilentChats();
    });
  }, { timezone: 'America/Sao_Paulo' });

  // ── segunda 08:00: resumo semanal por e-mail aos parceiros ────────────────
  cron.schedule('0 8 * * 1', () => {
    runJob('parceria:resumo-semanal', async () => {
      const { sendPartnerWeeklyDigests } = await import('../services/partnerWeeklyDigest');
      return await sendPartnerWeeklyDigests();
    });
  }, { timezone: 'America/Sao_Paulo' });

  // ── diário 07:10: audiências de casos de PARCERIA a 7 e 3 dias ── CRÍTICO ─
  cron.schedule('10 7 * * *', () => {
    runJob('parceria:alerta-audiencias', async () => {
      const { sendPartnerHearingAlerts } = await import('../services/partnerHearingAlerts');
      return await sendPartnerHearingAlerts();
    }, { critica: true });
  }, { timezone: 'America/Sao_Paulo' });

  // ── backup diário do banco: 02h (dump comprimido → MEGA) ── CRÍTICO ───────
  cron.schedule('0 2 * * *', () => {
    runJob('backup:diario', async () => {
      const r = await runBackup();
      if (!r.ok) throw new Error(`Backup não realizado: ${r.message}`);
      return { arquivo: r.file, kb: r.sizeKB };
    }, { critica: true });
  });

  // ── dia 1 do mês, 03h30: PROVA REAL do backup (restaura num banco temporário)
  // Backup que não restaura não é backup — por isso é CRÍTICO e não pode calar.
  cron.schedule('30 3 1 * *', () => {
    runJob('backup:prova-de-restauracao', async () => {
      const { runRestoreCheckAndNotify } = await import('../services/restoreService');
      return await runRestoreCheckAndNotify();
    }, { critica: true });

    // Vigia do peso da mídia do WhatsApp no banco (entra no dump diário do MEGA)
    runJob('whatsapp:peso-midia', async () => {
      const [[m]] = await db.query(
        'SELECT COALESCE(SUM(LENGTH(data)),0) AS bytes, COUNT(*) AS n FROM whatsapp_media'
      ) as any;
      const mb = Math.round(Number(m.bytes) / 1048576);
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
      return { arquivos: m.n, mb };
    });
  }, { timezone: 'America/Sao_Paulo' });

  // ── descoberta por OAB: diário 06h (varre tribunais e cadastra novos) ─────
  cron.schedule('0 6 * * *', () => {
    runJob('monitoramento:descoberta-oab', () => runDiscoveryJob());
  });

  // ── monitoramento processual: 08h e 16h ── CRÍTICO (movimentação perdida) ─
  cron.schedule('0 8,16 * * *', () => {
    runJob('monitoramento:processos', () => runMonitoringJob(), { critica: true });
  });

  // ── a cada hora: proposta em análise há 7+ dias → perdida (inativa) ───────
  cron.schedule('30 * * * *', () => {
    runJob('comercial:propostas-expiradas', async () => {
      const [r] = await db.query(`
        UPDATE leads
        SET status = 'perdida', analise_since = NULL
        WHERE status = 'proposta_em_analise'
          AND analise_since IS NOT NULL
          AND analise_since < (NOW() - INTERVAL 7 DAY)
      `) as any;
      return { expiradas: r.affectedRows };
    }, { silencioso: true });
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
  return { alertas: deadlines.length };
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
  return { eventos: events.length };
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
  return { vencidas: cobrancas.length };
}
