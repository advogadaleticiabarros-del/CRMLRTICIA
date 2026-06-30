import { Router, Request, Response } from 'express';
import { sendMorningBriefings } from '../services/morningBriefingService';

const router = Router();

// ── POST /api/briefing/run — dispara o resumo matinal agora (teste) ─────────
router.post('/run', async (_req: Request, res: Response) => {
  const r = await sendMorningBriefings();
  res.json({ success: true, ...r });
});

export default router;
