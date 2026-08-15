import { db } from '../config/database';
import { sendText } from './uazapiInstance';

/**
 * Dispara o alerta de "novo lead" (sino + WhatsApp) a partir de qualquer
 * ponto de entrada — formulário do site, atendimento convertido, cadastro
 * manual ou primeira mensagem no WhatsApp. Best-effort: falha de sino ou de
 * WhatsApp nunca derruba a criação do lead.
 */
const ALERT_NUMBERS = ['5544991274377', '5527995151402'];

export async function notifyNewLead(opts: {
  leadId: number;
  name: string;
  phone?: string | null;
  source?: string | null;
  area?: string | null;
  message?: string | null;
}): Promise<void> {
  const { leadId, name, phone, source, area, message } = opts;

  try {
    const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
    for (const a of admins) {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
         VALUES (?, ?, ?, 'lead_novo', 'sistema', NOW(), 'pendente')`,
        [a.id, 'Novo lead',
         `${name}${area ? ' · ' + area : ''} (lead nº ${leadId}).${phone ? ' Tel: ' + phone : ''}`]
      );
    }
  } catch { /* aviso é best-effort */ }

  const texto = [
    '🆕 *Novo lead*',
    `Nome: ${name}`,
    `Telefone: ${phone || 'Não informado'}`,
    `Origem: ${source || 'Não informado'}`,
    `Tipo de caso: ${area || 'Não informado'}`,
    `Relato: ${message && message.trim() ? message.trim() : 'Sem relato'}`,
  ].join('\n');

  for (const num of ALERT_NUMBERS) {
    try { await sendText(num, texto); } catch { /* best-effort */ }
  }
}
