import { Router, Request, Response } from 'express';
import { getGoalProgress, setGoalForMonth, currentMonth } from '../services/goalsService';

const router = Router();

// ── GET /api/goals/current — meta e progresso do mês atual ──────────────────
router.get('/current', async (_req: Request, res: Response) => {
  const progress = await getGoalProgress();
  res.json(progress);
});

// ── PUT /api/goals/current — ajusta manualmente a meta do mês atual ─────────
router.put('/current', async (req: Request, res: Response) => {
  const target = Number(req.body?.target);
  if (!target || target <= 0) { res.status(400).json({ error: 'Informe um valor de meta válido' }); return; }
  await setGoalForMonth(currentMonth(), target);
  const progress = await getGoalProgress();
  res.json(progress);
});

export default router;
