import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { normalizeChannel } from '../services/leadChannel';

const router = Router();

// Anti-spam simples: máx. 5 envios por IP a cada 15 min + campo honeypot.
const WINDOW_MS = 15 * 60 * 1000;
const hits = new Map<string, { count: number; first: number }>();
function tooMany(ip: string): boolean {
  const h = hits.get(ip);
  if (!h || Date.now() - h.first > WINDOW_MS) { hits.set(ip, { count: 1, first: Date.now() }); return false; }
  h.count++;
  if (hits.size > 5000) hits.clear();
  return h.count > 5;
}

// ── POST /api/public/lead — formulário do site/blog cai direto no funil ──────
// Campos: name*, phone, email, area, message, website (honeypot — deve vir vazio).
// CORS aberto: o formulário vive no domínio do blog (Hostinger), não no CRM.
router.options('/lead', (_req: Request, res: Response) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.sendStatus(204);
});

router.post('/lead', async (req: Request, res: Response) => {
  res.set('Access-Control-Allow-Origin', '*');
  const b = req.body || {};
  if (b.website) { res.json({ success: true }); return; } // honeypot: bot preencheu — finge sucesso
  if (tooMany(req.ip || 'ip')) { res.status(429).json({ error: 'Muitos envios — tente mais tarde' }); return; }

  const name = String(b.name || '').trim();
  if (name.length < 3) { res.status(400).json({ error: 'Informe seu nome' }); return; }
  const phone = String(b.phone || '').replace(/\D/g, '').slice(0, 15) || null;
  const email = String(b.email || '').trim().slice(0, 255) || null;
  const area = String(b.area || '').trim().slice(0, 100) || null;
  const message = String(b.message || '').trim().slice(0, 2000);

  // UTM: aceita tanto no body (form que já leu location.search via JS) quanto
  // na própria query string do POST (link do anúncio/bio apontando direto pra cá).
  const q = req.query || {};
  const pick = (k: string) => String(b[k] ?? q[k] ?? '').trim().slice(0, 150) || null;
  const utm_source = pick('utm_source');
  const utm_medium = pick('utm_medium');
  const utm_campaign = pick('utm_campaign');
  const utm_content = pick('utm_content');
  const utm_term = pick('utm_term');
  const landing_page = String(b.landing_page || req.get('referer') || '').trim().slice(0, 500) || null;
  const source = normalizeChannel({ utm_source, utm_medium, fallback: 'site' });

  const [[admin]] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1") as any;
  if (!admin) { res.status(500).json({ error: 'Indisponível' }); return; }

  // Não duplica: mesmo telefone/e-mail nas últimas 24h só atualiza o resumo.
  const [[dup]] = await db.query(
    `SELECT id FROM leads WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
       AND ((? IS NOT NULL AND phone = ?) OR (? IS NOT NULL AND email = ?)) LIMIT 1`,
    [phone, phone, email, email]
  ) as any;
  if (dup) {
    await db.query('UPDATE leads SET case_summary = CONCAT(COALESCE(case_summary,\'\'), \'\n---\n\', ?) WHERE id = ?',
      [`Novo envio pelo site: ${message}`, dup.id]).catch(() => {});
    res.json({ success: true });
    return;
  }

  const [ins] = await db.query(
    `INSERT INTO leads (user_id, name, phone, email, source, legal_area, status, case_summary,
                         utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_page)
     VALUES (?, ?, ?, ?, ?, ?, 'triagem', ?, ?, ?, ?, ?, ?, ?)`,
    [admin.id, name, phone, email, source, area, message ? `Mensagem enviada pelo site:\n"${message}"` : null,
     utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_page]
  ) as any;

  try {
    const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
    for (const a of admins) {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
         VALUES (?, ?, ?, 'lead_site', 'sistema', NOW(), 'pendente')`,
        [a.id, 'Novo lead pelo site',
         `${name}${area ? ' · ' + area : ''} preencheu o formulário do site (lead nº ${ins.insertId}).${phone ? ' Tel: ' + phone : ''}`]
      );
    }
  } catch { /* aviso é best-effort */ }

  res.status(201).json({ success: true });
});

export default router;
