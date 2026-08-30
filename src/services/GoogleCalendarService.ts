import { google, calendar_v3 } from 'googleapis';
import { encrypt, decrypt } from '../utils/crypto';
import { db } from '../config/database';
import { collectAllPages } from './googlePagination';

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
  /**
   * Cor do evento no Google (1–11, ver `colorId` da API). Normalmente
   * calculada a partir do status de negócio com `statusToGoogleColorId`
   * — não é livre, o Google só aceita esse conjunto fixo de IDs.
   */
  colorId?: string;
}

/**
 * Status de negócio "agendado/realizado/cancelado" (calendar_events.status)
 * — e os equivalentes de `dative_hearings.status` ('agendada'/'realizada'/
 * 'adiada'/'cancelada'), que usa outro enum mas deve mapear para a mesma
 * cor. Pedido da cliente: ela se organiza na agenda do Google por cor
 * (verde = já realizado, vermelho = cancelado, azul = agendado) e quer que
 * o CRM reproduza isso automaticamente.
 *
 * `colorId` da API do Google Calendar é fechado (1–11, ver
 * https://developers.google.com/calendar/api/v3/reference/colors) — não dá
 * pra mandar uma cor livre. IDs escolhidos:
 *   '10' Basil (verde)   — realizado/realizada
 *   '11' Tomato (vermelho) — cancelado/cancelada/adiada
 *   '9'  Blueberry (azul) — agendado/agendada (default)
 */
export function statusToGoogleColorId(status: string | null | undefined): string {
  switch (status) {
    case 'realizado':
    case 'realizada':
      return '10'; // Basil — verde
    case 'cancelado':
    case 'cancelada':
    case 'adiada':
      return '11'; // Tomato — vermelho
    case 'agendado':
    case 'agendada':
    default:
      return '9'; // Blueberry — azul
  }
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
    // Os tokens são cifrados em repouso (LGPD) ao salvar — ver google-callback.ts
    // e o handler 'tokens' abaixo. Faltava decifrar aqui na leitura: o Google
    // recebia o texto cifrado como se fosse o token real, e toda chamada falhava
    // com invalid_grant (o refresh_token "cifrado" não é um refresh_token válido).
    this.oauth2Client.setCredentials({
      access_token: decrypt(account.access_token),
      refresh_token: decrypt(account.refresh_token),
      expiry_date: new Date(account.token_expiry).getTime(),
    });

    // Refresh token if expired
    this.oauth2Client.on('tokens', async (newTokens) => {
      if (newTokens.access_token) {
        await db.query(
          'UPDATE google_accounts SET access_token = ?, token_expiry = ? WHERE user_id = ?',
          [encrypt(newTokens.access_token), new Date(newTokens.expiry_date ?? Date.now() + 3600_000), userId]
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
      ...(payload.colorId && { colorId: payload.colorId }),
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
    if (payload.colorId)       patch.colorId = payload.colorId;

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
        // Paginação: sem isso, calendários com muitos eventos no período de 25
        // meses varrido perdiam compromissos futuros — a API só devolve
        // `maxResults` por página, e a antiga chamada única ignorava
        // `nextPageToken` (bug confirmado: eventos ordenados do mais antigo pro
        // mais novo, então o corte comia justamente o que estava por vir).
        const items = await collectAllPages<calendar_v3.Schema$Event>(async (pageToken) => {
          const response = await calendar.events.list({
            calendarId: cal.id!,
            timeMin, timeMax, maxResults,
            singleEvents: true,
            orderBy: 'startTime',
            pageToken,
          });
          return { items: response.data.items ?? undefined, nextPageToken: response.data.nextPageToken };
        });
        for (const ev of items) {
          (ev as any)._calendarName = cal.summary ?? null;
          all.push(ev);
        }
      } catch { /* calendário sem acesso de leitura: ignora */ }
    }
    return all;
  }
}

export const googleCalendarService = new GoogleCalendarService();
