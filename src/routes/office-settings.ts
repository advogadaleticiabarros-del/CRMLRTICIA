import { Router, Request, Response } from 'express';
import { db } from '../config/database';

const router = Router();

// Chaves conhecidas — usadas no portal do cliente (Pix e contato).
const KEYS = ['pix_key', 'pix_nome', 'pix_cidade', 'whatsapp', 'multa_percent', 'juros_mes_percent', 'meta_faturamento_mes', 'google_review_url'];

// ── GET /api/office-settings — config do escritório (Pix, WhatsApp) ─────────
router.get('/', async (_req: Request, res: Response) => {
  const [rows] = await db.query('SELECT setting_key, setting_value FROM office_settings') as any;
  const out: Record<string, string> = {};
  for (const k of KEYS) out[k] = '';
  for (const r of rows) if (KEYS.includes(r.setting_key)) out[r.setting_key] = r.setting_value || '';
  res.json(out);
});

// ── PATCH /api/office-settings — grava (upsert) as chaves conhecidas ────────
router.patch('/', async (req: Request, res: Response) => {
  for (const k of KEYS) {
    if (req.body[k] === undefined) continue;
    await db.query(
      'INSERT INTO office_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
      [k, String(req.body[k] ?? '').trim()]
    );
  }
  res.json({ success: true });
});

export default router;
