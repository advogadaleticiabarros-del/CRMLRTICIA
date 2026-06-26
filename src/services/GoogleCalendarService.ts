import { google, calendar_v3 } from 'googleapis';
import { db } from '../config/database';

interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  token_expiry: Date;
}

interface CalendarEventPayload {
  title: string;
  description?: string;
  /** Hora de parede do compromisso (string do datetime-local ou DATETIME do banco). */
  startDatetime: string | Date;
  endDatetime: string | Date;
  location?: string;
  generateMeet?: boolean;
}

/** Fuso de referência do escritório. Pode ser sobrescrito por env. */
export const CRM_TIMEZONE = process.env.CRM_TIMEZONE || 'America/Sao_Paulo';

/**
 * Converte a hora de parede do CRM para o formato que o Google Calendar espera:
 * uma data-hora "ingênua" `YYYY-MM-DDTHH:mm:ss` (SEM `Z`/offset) que será
 * interpretada no `timeZone` enviado junto (CRM_TIMEZONE).
 *
 * Não usar `Date.toISOString()` aqui: ele anexa `Z` (UTC) e o Google passa a
 * ignorar o `timeZone`, deslocando o horário (bug do fuso).
 *
 * - String (ex.: do datetime-local `2026-06-26T14:00`): pega a parte de
 *   data/hora literal, ignorando qualquer `Z`/offset.
 * - Date (vindo do MySQL, lido como UTC pois o pool usa `timezone: 'Z'`):
 *   recupera os componentes via getters UTC, devolvendo a parede original.
 */
export function toNaiveLocalDateTime(value: string | Date): string {
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}`;
    value = new Date(value); // fallback para formatos não previstos
  }
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${value.getUTCFullYear()}-${p(value.getUTCMonth() + 1)}-${p(value.getUTCDate())}` +
    `T${p(value.getUTCHours())}:${p(value.getUTCMinutes())}:${p(value.getUTCSeconds())}`
  );
}

export class GoogleCalendarService {
  private oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  getAuthUrl(state?: string): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      state,
      scope: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
    });
  }

  async exchangeCode(code: string): Promise<GoogleTokens> {
    const { tokens } = await this.oauth2Client.getToken(code);
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error('Tokens incompletos retornados pelo Google');
    }
    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expiry: new Date(tokens.expiry_date ?? Date.now() + 3600_000),
    };
  }

  private async getClientForUser(userId: number): Promise<typeof this.oauth2Client> {
    const [rows] = await db.query(
      'SELECT access_token, refresh_token, token_expiry FROM google_accounts WHERE user_id = ?',
      [userId]
    ) as any;

    if (!rows.length) throw new Error('Conta Google não conectada para este usuário');

    const account = rows[0];
    this.oauth2Client.setCredentials({
      access_token: account.access_token,
      refresh_token: account.refresh_token,
      expiry_date: new Date(account.token_expiry).getTime(),
    });

    // Refresh token if expired
    this.oauth2Client.on('tokens', async (newTokens) => {
      if (newTokens.access_token) {
        await db.query(
          'UPDATE google_accounts SET access_token = ?, token_expiry = ? WHERE user_id = ?',
          [newTokens.access_token, new Date(newTokens.expiry_date ?? Date.now() + 3600_000), userId]
        );
      }
    });

    return this.oauth2Client;
  }

  async createEvent(
    userId: number,
    payload: CalendarEventPayload
  ): Promise<{ googleEventId: string; videoLink?: string }> {
    const auth = await this.getClientForUser(userId);
    const calendar = google.calendar({ version: 'v3', auth });

    const event: calendar_v3.Schema$Event = {
      summary: payload.title,
      description: payload.description,
      location: payload.location,
      start: { dateTime: toNaiveLocalDateTime(payload.startDatetime), timeZone: CRM_TIMEZONE },
      end:   { dateTime: toNaiveLocalDateTime(payload.endDatetime),   timeZone: CRM_TIMEZONE },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email',  minutes: 60 },
          { method: 'popup',  minutes: 15 },
        ],
      },
      ...(payload.generateMeet && {
        conferenceData: {
          createRequest: {
            requestId: `crm-${Date.now()}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      }),
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
      conferenceDataVersion: payload.generateMeet ? 1 : 0,
    });

    const created = response.data;
    const videoLink = created.conferenceData?.entryPoints?.find(
      (ep) => ep.entryPointType === 'video'
    )?.uri ?? undefined;

    return {
      googleEventId: created.id!,
      videoLink,
    };
  }

  async updateEvent(userId: number, googleEventId: string, payload: Partial<CalendarEventPayload>): Promise<void> {
    const auth = await this.getClientForUser(userId);
    const calendar = google.calendar({ version: 'v3', auth });

    const patch: calendar_v3.Schema$Event = {};
    if (payload.title) patch.summary = payload.title;
    if (payload.description !== undefined) patch.description = payload.description;
    if (payload.startDatetime) patch.start = { dateTime: toNaiveLocalDateTime(payload.startDatetime), timeZone: CRM_TIMEZONE };
    if (payload.endDatetime)   patch.end   = { dateTime: toNaiveLocalDateTime(payload.endDatetime),   timeZone: CRM_TIMEZONE };

    await calendar.events.patch({ calendarId: 'primary', eventId: googleEventId, requestBody: patch });
  }

  async deleteEvent(userId: number, googleEventId: string): Promise<void> {
    const auth = await this.getClientForUser(userId);
    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.delete({ calendarId: 'primary', eventId: googleEventId });
  }

  async listUpcomingEvents(userId: number, maxResults = 250): Promise<calendar_v3.Schema$Event[]> {
    const auth = await this.getClientForUser(userId);
    const calendar = google.calendar({ version: 'v3', auth });

    // Janela: do primeiro dia do mês anterior (ex.: 01/05/2026) até 24 meses à frente.
    const now = new Date();
    const timeMin = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const timeMax = new Date(now.getFullYear(), now.getMonth() + 24, 1).toISOString();

    // Varre TODOS os calendários do usuário (não só o primary), pulando feriados
    // e aniversários de contatos. Assim nenhum compromisso fica de fora.
    let calendars: calendar_v3.Schema$CalendarListEntry[] = [];
    try {
      const cl = await calendar.calendarList.list({ maxResults: 250, showHidden: false });
      calendars = (cl.data.items ?? []).filter((c) => {
        const id = c.id ?? '';
        return !id.includes('#holiday@') && !id.includes('#contacts@');
      });
    } catch {
      calendars = [{ id: 'primary' }];
    }
    if (!calendars.length) calendars = [{ id: 'primary' }];

    const all: calendar_v3.Schema$Event[] = [];
    for (const cal of calendars) {
      try {
        const response = await calendar.events.list({
          calendarId: cal.id!,
          timeMin, timeMax, maxResults,
          singleEvents: true,
          orderBy: 'startTime',
        });
        for (const ev of response.data.items ?? []) {
          (ev as any)._calendarName = cal.summary ?? null;
          all.push(ev);
        }
      } catch { /* calendário sem acesso de leitura: ignora */ }
    }
    return all;
  }
}

export const googleCalendarService = new GoogleCalendarService();
