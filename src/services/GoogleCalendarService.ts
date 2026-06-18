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
  startDatetime: Date;
  endDatetime: Date;
  location?: string;
  generateMeet?: boolean;
}

export class GoogleCalendarService {
  private oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  getAuthUrl(): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
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
      start: { dateTime: payload.startDatetime.toISOString(), timeZone: 'America/Sao_Paulo' },
      end:   { dateTime: payload.endDatetime.toISOString(),   timeZone: 'America/Sao_Paulo' },
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
    if (payload.startDatetime) patch.start = { dateTime: payload.startDatetime.toISOString(), timeZone: 'America/Sao_Paulo' };
    if (payload.endDatetime)   patch.end   = { dateTime: payload.endDatetime.toISOString(),   timeZone: 'America/Sao_Paulo' };

    await calendar.events.patch({ calendarId: 'primary', eventId: googleEventId, requestBody: patch });
  }

  async deleteEvent(userId: number, googleEventId: string): Promise<void> {
    const auth = await this.getClientForUser(userId);
    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.delete({ calendarId: 'primary', eventId: googleEventId });
  }

  async listUpcomingEvents(userId: number, maxResults = 50): Promise<calendar_v3.Schema$Event[]> {
    const auth = await this.getClientForUser(userId);
    const calendar = google.calendar({ version: 'v3', auth });

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults,
      singleEvents: true,
      orderBy: 'startTime',
    });

    return response.data.items ?? [];
  }
}

export const googleCalendarService = new GoogleCalendarService();
