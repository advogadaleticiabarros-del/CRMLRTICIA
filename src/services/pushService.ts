import webpush from 'web-push';
import { db } from '../config/database';

/**
 * Web Push (VAPID) — entrega notificações mesmo com o app fechado.
 * Configurado por ambiente: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e
 * VAPID_SUBJECT (mailto: ou URL). Sem as chaves, o serviço fica inativo
 * (no-op) e o resto do sistema segue funcionando normalmente.
 *
 * Gerar um par de chaves: npx web-push generate-vapid-keys
 */
const PUB = process.env.VAPID_PUBLIC_KEY || '';
const PRIV = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:contato@advogadaleticiabarros.com';

let configured = false;
if (PUB && PRIV) {
  try { webpush.setVapidDetails(SUBJECT, PUB, PRIV); configured = true; }
  catch { configured = false; }
}

export function pushConfigured(): boolean { return configured; }
export function vapidPublicKey(): string { return PUB; }

export interface BrowserSubscription {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
}

export async function saveSubscription(userId: number, sub: BrowserSubscription): Promise<void> {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return;
  await db.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth)`,
    [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
  );
}

export async function removeSubscription(endpoint: string): Promise<void> {
  if (!endpoint) return;
  await db.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
}

/** Envia um push para todos os dispositivos do usuário. Remove inscrições mortas. */
export async function sendToUser(userId: number, payload: { title: string; body?: string; url?: string; tag?: string }): Promise<void> {
  if (!configured) return;
  try {
    const [rows] = await db.query(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?', [userId]
    ) as any;
    if (!rows.length) return;
    const data = JSON.stringify({ title: payload.title, body: payload.body || '', url: payload.url || '/', tag: payload.tag });
    for (const r of rows) {
      try {
        await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, data);
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) await removeSubscription(r.endpoint);
      }
    }
  } catch { /* best-effort */ }
}
