import { db } from '../config/database';

interface WhatsAppConfig {
  provider: string;
  access_token: string;
  phone_number_id: string;
  recipient_phone: string;
}

interface WhatsAppMessage {
  title: string;
  body: string;
}

/**
 * Serviço de notificações via WhatsApp — PREPARADO para a Meta WhatsApp Cloud API.
 * Fica inativo até que o usuário configure access_token + phone_number_id + recipient
 * e marque enabled=1 em whatsapp_settings. A estrutura de envio já está pronta.
 */
export class WhatsAppNotificationService {
  private readonly apiBase = 'https://graph.facebook.com/v21.0';

  private async getConfig(userId: number): Promise<WhatsAppConfig | null> {
    const [rows] = await db.query(
      `SELECT provider, access_token, phone_number_id, recipient_phone
       FROM whatsapp_settings
       WHERE user_id = ? AND enabled = 1
         AND access_token IS NOT NULL AND phone_number_id IS NOT NULL AND recipient_phone IS NOT NULL`,
      [userId]
    ) as any;
    return rows[0] ?? null;
  }

  /** Envia uma mensagem. Retorna false se o WhatsApp ainda não estiver configurado/ativo. */
  async send(userId: number, msg: WhatsAppMessage): Promise<boolean> {
    const config = await this.getConfig(userId);
    if (!config) return false; // ainda não configurado — recurso preparado

    const url = `${this.apiBase}/${config.phone_number_id}/messages`;
    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      to: config.recipient_phone,
      type: 'text',
      text: { body: `*${msg.title}*\n\n${msg.body}` },
    });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.access_token}`,
          'Content-Type': 'application/json',
        },
        body,
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Indica se o usuário já tem WhatsApp ativo e configurado. */
  async isConfigured(userId: number): Promise<boolean> {
    return (await this.getConfig(userId)) !== null;
  }
}

export const whatsappNotificationService = new WhatsAppNotificationService();
