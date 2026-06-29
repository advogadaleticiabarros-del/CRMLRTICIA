import { Router, Request, Response } from 'express';
import { listRules, setRuleEnabled } from '../services/automationService';

const router = Router();

// GET /api/automation/rules — lista as regras (playbooks) com estado atual
router.get('/rules', async (_req: Request, res: Response) => {
  res.json(await listRules());
});

// PATCH /api/automation/rules/:key — liga/desliga uma regra
router.patch('/rules/:key', async (req: Request, res: Response) => {
  const ok = await setRuleEnabled(req.params.key, !!req.body.enabled);
  if (!ok) { res.status(404).json({ error: 'Regra não encontrada' }); return; }
  res.json({ success: true });
});

export default router;
