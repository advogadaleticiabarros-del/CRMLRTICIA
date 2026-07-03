import { Router, Request, Response } from 'express';
import { getSeries } from '../services/metricsSnapshotService';

const router = Router();

// GET /api/metrics/series?days=30 — série diária das métricas do cockpit (sparklines)
router.get('/series', async (req: Request, res: Response) => {
  const days = Math.min(120, Math.max(7, parseInt(req.query.days as string) || 30));
  try { res.json(await getSeries(days)); } catch { res.json({}); }
});

export default router;
