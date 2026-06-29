import { Router, Request, Response } from 'express';
import { vapidPublicKey, saveSubscription, removeSubscription } from '../services/pushService';

const router = Router();

// GET /api/push/vapid-public — chave pública para o navegador se inscrever
router.get('/vapid-public', (_req: Request, res: Response) => {
  res.json({ key: vapidPublicKey() });
});

// POST /api/push/subscribe — salva a inscrição do dispositivo do usuário
router.post('/subscribe', async (req: Request, res: Response) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint) { res.status(400).json({ error: 'Inscrição inválida' }); return; }
  await saveSubscription(req.user!.id, sub);
  res.json({ success: true });
});

// POST /api/push/unsubscribe — remove a inscrição
router.post('/unsubscribe', async (req: Request, res: Response) => {
  const endpoint = req.body?.endpoint;
  if (endpoint) await removeSubscription(endpoint);
  res.json({ success: true });
});

export default router;
