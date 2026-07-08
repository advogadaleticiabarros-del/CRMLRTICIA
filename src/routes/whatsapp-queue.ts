import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { enqueueWhatsapp, generateWhatsappQueue } from '../services/whatsappQueue';

const router = Router();

// ── GET /api/whatsapp-queue — pendentes + enviadas recentes ─────────────────
router.get('/', async (_req: Request, res: Response) => {
  const [pendentes] = await db.query(
    `SELECT id, client_id, recipient_name, phone, message, context, created_at
       FROM whatsapp_queue WHERE status = 'pendente' ORDER BY created_at ASC`) as any;
  const [enviadas] = await db.query(
    `SELECT id, recipient_name, phone, context, sent_at
       FROM whatsapp_queue WHERE status = 'enviada' ORDER BY sent_at DESC LIMIT 20`) as any;
  res.json({ pendentes, enviadas });
});

// ── POST /api/whatsapp-queue — mensagem avulsa ──────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { client_id, name, phone, message } = req.body || {};
  if (!name || !phone || !message) { res.status(400).json({ error: 'Informe nome, telefone e mensagem' }); return; }
  const ok = await enqueueWhatsapp({ clientId: client_id || null, name, phone, message, context: 'avulsa' });
  if (!ok) { res.status(400).json({ error: 'Telefone inválido (informe DDD + número)' }); return; }
  res.status(201).json({ success: true });
});

// ── POST /api/whatsapp-queue/gerar — força a geração agora (além do cron) ───
router.post('/gerar', async (_req: Request, res: Response) => {
  const created = await generateWhatsappQueue();
  res.json({ created });
});

// ── POST /api/whatsapp-queue/:id/enviada — marca como enviada ───────────────
router.post('/:id/enviada', async (req: Request, res: Response) => {
  await db.query("UPDATE whatsapp_queue SET status = 'enviada', sent_at = NOW() WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

// ── POST /api/whatsapp-queue/:id/descartar ──────────────────────────────────
router.post('/:id/descartar', async (req: Request, res: Response) => {
  await db.query("UPDATE whatsapp_queue SET status = 'descartada' WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

export default router;
