import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { getCourtEmailAuthUrl, getCourtEmailStatus, disconnectCourtEmail, runCourtEmailScan } from '../services/courtEmailMonitorService';

/**
 * Rotas do monitoramento de movimentação processual por e-mail (item 7 —
 * plano B do DJEN, ver courtEmailMonitorService.ts). Mesmo padrão de
 * /api/email-intake/integration (Gmail do parceiro), mas com conexão OAuth
 * própria e dedicada — a Dra. Letícia escolhe QUAL conta conectar em
 * Configurações, o servidor nunca assume nem hardcoda um e-mail.
 */
const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  res.json(await getCourtEmailStatus());
});

router.get('/auth-url', (req: Request, res: Response) => {
  if (!env.GOOGLE_CLIENT_ID) { res.status(400).json({ error: 'OAuth Google não configurado no servidor' }); return; }
  const state = jwt.sign({ id: req.user!.id, purpose: 'court_email' }, env.JWT_SECRET, { expiresIn: '15m' });
  res.json({ url: getCourtEmailAuthUrl(state) });
});

router.post('/disconnect', async (_req: Request, res: Response) => {
  await disconnectCourtEmail();
  res.json({ success: true });
});

router.post('/scan-now', async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, ...(await runCourtEmailScan()) });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
