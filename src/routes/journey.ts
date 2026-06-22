import { Router, Request, Response } from 'express';
import { getJourney } from '../services/JourneyService';

const router = Router();

// ── GET /api/journey?lead_id= | client_id= — histórico unificado ────────────
router.get('/', async (req: Request, res: Response) => {
  const leadId = req.query.lead_id ? Number(req.query.lead_id) : undefined;
  const clientId = req.query.client_id ? Number(req.query.client_id) : undefined;
  if (!leadId && !clientId) {
    res.status(400).json({ error: 'Informe lead_id ou client_id' });
    return;
  }
  const events = await getJourney({ leadId, clientId });
  res.json({ events, total: events.length });
});

export default router;
