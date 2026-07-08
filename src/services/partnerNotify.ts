import { db } from '../config/database';
import { sendEmail, layout } from './EmailService';

/**
 * Notifica os usuários do PORTAL DO PARCEIRO (papel parceiro_portal) de um
 * parceiro: sino no CRM e, opcionalmente, e-mail. Best-effort (não lança).
 */
export async function notifyPartnerUsers(partnerId: number, opts: {
  title: string;            // título do sino
  message: string;          // texto do sino
  caseId?: number | null;
  notificationType?: string;
  emailSubject?: string;    // se presente (com emailHtml), envia e-mail também
  emailHtmlBody?: string;   // corpo (vai dentro do layout da marca)
}): Promise<void> {
  try {
    const [users] = await db.query(
      "SELECT id, name, email FROM users WHERE role = 'parceiro_portal' AND partner_id = ? AND active = 1",
      [partnerId]
    ) as any;

    for (const u of users) {
      await db.query(
        `INSERT INTO notifications (user_id, case_id, title, message, notification_type, channel, scheduled_at, status)
         VALUES (?, ?, ?, ?, ?, 'sistema', NOW(), 'pendente')`,
        [u.id, opts.caseId ?? null, opts.title, opts.message, opts.notificationType || 'parceria']
      ).catch(() => {});

      if (opts.emailSubject && opts.emailHtmlBody && u.email && u.email.includes('@')) {
        await sendEmail({
          to: u.email,
          subject: opts.emailSubject,
          html: layout(opts.title, opts.emailHtmlBody),
        }).catch(() => {});
      }
    }
  } catch { /* best-effort */ }
}
