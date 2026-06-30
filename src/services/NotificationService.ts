import { db } from '../config/database';
import { telegramNotificationService } from './TelegramNotificationService';
import { whatsappNotificationService } from './WhatsAppNotificationService';
import { sendToUser as sendPushToUser } from './pushService';

type NotificationChannel = 'sistema' | 'som' | 'telegram' | 'whatsapp';
type NotificationStatus = 'pendente' | 'enviada' | 'lida' | 'erro';

interface CreateNotificationInput {
  userId: number;
  title: string;
  message: string;
  notificationType: string;
  channel: NotificationChannel;
  scheduledAt: Date;
  clientId?: number;
  caseId?: number;
  taskId?: number;
  deadlineId?: number;
  calendarEventId?: number;
}

export class NotificationService {
  async create(input: CreateNotificationInput): Promise<number> {
    const [result] = await db.query(
      `INSERT INTO notifications
        (user_id, client_id, case_id, task_id, deadline_id, calendar_event_id,
         title, message, notification_type, channel, status, scheduled_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.userId,
        input.clientId ?? null,
        input.caseId ?? null,
        input.taskId ?? null,
        input.deadlineId ?? null,
        input.calendarEventId ?? null,
        input.title,
        input.message,
        input.notificationType,
        input.channel,
        'pendente',
        input.scheduledAt,
      ]
    ) as any;
    return result.insertId;
  }

  async markAsRead(notificationId: number, userId: number): Promise<void> {
    await db.query(
      "UPDATE notifications SET status = 'lida' WHERE id = ? AND user_id = ?",
      [notificationId, userId]
    );
  }

  async getUnread(userId: number) {
    // O sininho mostra só PRIORIDADES — exclui as movimentações/alertas de rotina
    // (eram 50+ por sincronização). Prazos, audiências, cobranças etc. continuam.
    const [rows] = await db.query(
      `SELECT n.*, c.name AS client_name
       FROM notifications n
       LEFT JOIN clients c ON c.id = n.client_id
       WHERE n.user_id = ? AND n.status IN ('pendente', 'enviada')
         AND n.notification_type NOT IN ('nova_movimentacao', 'alerta_movimentacao')
       ORDER BY n.scheduled_at DESC
       LIMIT 50`,
      [userId]
    ) as any;
    return rows;
  }

  async getPending(): Promise<any[]> {
    const [rows] = await db.query(
      `SELECT * FROM notifications
       WHERE status = 'pendente' AND scheduled_at <= NOW()
       ORDER BY scheduled_at ASC
       LIMIT 100`
    ) as any;
    return rows;
  }

  async dispatch(notification: any): Promise<void> {
    try {
      let sent = false;

      if (notification.channel === 'telegram') {
        sent = await telegramNotificationService.send(notification.user_id, {
          title: notification.title,
          body: notification.message,
          urgency: this.resolveUrgency(notification.notification_type),
        });
      } else if (notification.channel === 'whatsapp') {
        sent = await whatsappNotificationService.send(notification.user_id, {
          title: notification.title,
          body: notification.message,
        });
      } else {
        // 'sistema' and 'som' são exibidos no app via polling; além disso,
        // enviamos um Web Push para alertar mesmo com o app fechado.
        await sendPushToUser(notification.user_id, {
          title: notification.title,
          body: notification.message,
          tag: `notif-${notification.id}`,
        });
        sent = true;
      }

      await db.query(
        `UPDATE notifications
         SET status = ?, sent_at = NOW(), error_message = NULL
         WHERE id = ?`,
        [sent ? 'enviada' : 'erro', notification.id]
      );
    } catch (err: any) {
      await db.query(
        "UPDATE notifications SET status = 'erro', error_message = ? WHERE id = ?",
        [err.message, notification.id]
      );
    }
  }

  private resolveUrgency(type: string): 'low' | 'normal' | 'high' | 'critical' {
    if (type.includes('vencido') || type.includes('urgente')) return 'critical';
    if (type.includes('proximo') || type.includes('atencao')) return 'high';
    return 'normal';
  }

  async getSettings(userId: number) {
    const [rows] = await db.query(
      'SELECT * FROM notification_settings WHERE user_id = ?',
      [userId]
    ) as any;
    return rows[0] ?? null;
  }

  async updateSettings(userId: number, settings: {
    sound_enabled?: boolean;
    telegram_enabled?: boolean;
    whatsapp_enabled?: boolean;
    reminder_minutes_before?: number;
  }): Promise<void> {
    await db.query(
      `INSERT INTO notification_settings (user_id, sound_enabled, telegram_enabled, whatsapp_enabled, reminder_minutes_before)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         sound_enabled = VALUES(sound_enabled),
         telegram_enabled = VALUES(telegram_enabled),
         whatsapp_enabled = VALUES(whatsapp_enabled),
         reminder_minutes_before = VALUES(reminder_minutes_before)`,
      [
        userId,
        settings.sound_enabled ?? 1,
        settings.telegram_enabled ?? 0,
        settings.whatsapp_enabled ?? 0,
        settings.reminder_minutes_before ?? 15,
      ]
    );
  }
}

export const notificationService = new NotificationService();
