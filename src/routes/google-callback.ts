import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../config/database';
import { env } from '../config/env';
import { googleCalendarService } from '../services/GoogleCalendarService';
import { calendarSyncService } from '../services/CalendarSyncService';

/**
 * Callback público do OAuth Google. O navegador é redirecionado pelo Google
 * sem o JWT do CRM, então a identidade do usuário vem no parâmetro `state`
 * (um JWT curto gerado no /google/auth-url).
 */
export async function googleOAuthCallback(req: Request, res: Response): Promise<void> {
  const code = req.query.code as string;
  const state = req.query.state as string;

  if (!code || !state) {
    res.redirect('/?google=error');
    return;
  }

  let userId: number;
  try {
    const payload = jwt.verify(state, env.JWT_SECRET) as { id: number };
    userId = payload.id;
  } catch {
    res.redirect('/?google=error');
    return;
  }

  try {
    const tokens = await googleCalendarService.exchangeCode(code);

    const { google } = await import('googleapis');
    const oauth2 = new google.auth.OAuth2(
      env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI
    );
    oauth2.setCredentials({ access_token: tokens.access_token });
    const { data } = await google.oauth2({ version: 'v2', auth: oauth2 }).userinfo.get();

    await db.query(
      `INSERT INTO google_accounts (user_id, google_email, access_token, refresh_token, token_expiry, sync_enabled)
       VALUES (?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         google_email = VALUES(google_email),
         access_token = VALUES(access_token),
         refresh_token = VALUES(refresh_token),
         token_expiry = VALUES(token_expiry),
         sync_enabled = 1`,
      [userId, data.email, tokens.access_token, tokens.refresh_token, tokens.token_expiry]
    );

    await calendarSyncService.syncFromGoogle(userId);
    res.redirect('/?google=connected');
  } catch {
    res.redirect('/?google=error');
  }
}
