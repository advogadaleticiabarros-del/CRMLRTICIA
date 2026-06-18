import { db } from '../config/database';

interface TelegramConfig {
  bot_token: string;
  chat_id: string;
}

interface TelegramMessage {
  title: string;
  body: string;
  emoji?: string;
  urgency?: 'low' | 'normal' | 'high' | 'critical';
}

export class TelegramNotificationService {
  private readonly apiBase = 'https://api.telegram.org/bot';

  private formatMessage(msg: TelegramMessage): string {
    const emojiMap: Record<string, string> = {
      low: 'ℹ️',
      normal: '📋',
      high: '⚠️',
      critical: '🚨',
    };
    const icon = msg.emoji ?? emojiMap[msg.urgency ?? 'normal'];
    return `${icon} *${this.escapeMarkdown(msg.title)}*\n\n${this.escapeMarkdown(msg.body)}`;
  }

  private escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, (c) => `\\${c}`);
  }

  private async getConfig(userId: number): Promise<TelegramConfig | null> {
    const [rows] = await db.query(
      'SELECT bot_token, chat_id FROM telegram_settings WHERE user_id = ? AND enabled = 1',
      [userId]
    ) as any;
    return rows[0] ?? null;
  }

  async send(userId: number, msg: TelegramMessage): Promise<boolean> {
    const config = await this.getConfig(userId);
    if (!config) return false;

    const url = `${this.apiBase}${config.bot_token}/sendMessage`;
    const body = JSON.stringify({
      chat_id: config.chat_id,
      text: this.formatMessage(msg),
      parse_mode: 'MarkdownV2',
    });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async sendReuniaoAgendada(userId: number, opts: { clientName: string; dateTime: string }): Promise<boolean> {
    return this.send(userId, {
      title: 'Reunião agendada',
      body: `Cliente: ${opts.clientName}\nData/Hora: ${opts.dateTime}`,
      urgency: 'normal',
    });
  }

  async sendReuniaoProxima(userId: number, opts: { clientName: string; minutesLeft: number }): Promise<boolean> {
    return this.send(userId, {
      title: 'Reunião em breve',
      body: `Reunião com ${opts.clientName} começa em ${opts.minutesLeft} minuto(s).`,
      urgency: 'high',
    });
  }

  async sendAudienciaProxima(userId: number, opts: { caseRef: string; minutesLeft: number }): Promise<boolean> {
    return this.send(userId, {
      title: 'Audiência próxima',
      body: `Audiência do processo ${opts.caseRef} começa em ${opts.minutesLeft} minuto(s).`,
      urgency: 'critical',
    });
  }

  async sendPrazoProcessual(userId: number, opts: { caseRef: string; daysLeft: number }): Promise<boolean> {
    const urgency = opts.daysLeft <= 1 ? 'critical' : opts.daysLeft <= 3 ? 'high' : 'normal';
    return this.send(userId, {
      title: 'Prazo processual',
      body: `Processo: ${opts.caseRef}\nPrazo: ${opts.daysLeft} dia(s) restante(s).`,
      urgency,
    });
  }

  async sendPrazoVencido(userId: number, opts: { caseRef: string; description: string }): Promise<boolean> {
    return this.send(userId, {
      title: '🔴 Prazo VENCIDO',
      body: `Processo: ${opts.caseRef}\n${opts.description}`,
      emoji: '🔴',
      urgency: 'critical',
    });
  }

  async sendTarefaUrgente(userId: number, opts: { taskTitle: string; dueDate: string }): Promise<boolean> {
    return this.send(userId, {
      title: 'Tarefa urgente',
      body: `${opts.taskTitle}\nVencimento: ${opts.dueDate}`,
      urgency: 'high',
    });
  }

  async sendCobrancaVencida(userId: number, opts: { clientName: string; value: string }): Promise<boolean> {
    return this.send(userId, {
      title: 'Cobrança vencida',
      body: `Cliente: ${opts.clientName}\nValor: R$ ${opts.value}`,
      urgency: 'high',
    });
  }

  async sendMovimentacaoProcessual(userId: number, opts: { caseRef: string; movement: string }): Promise<boolean> {
    return this.send(userId, {
      title: 'Movimentação processual',
      body: `Processo: ${opts.caseRef}\n${opts.movement}`,
      urgency: 'normal',
    });
  }
}

export const telegramNotificationService = new TelegramNotificationService();
