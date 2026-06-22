import { Router, Request, Response } from 'express';
import { runBackup, listBackups } from '../services/backupService';

const router = Router();

// ── GET /api/backup — lista os backups no MEGA ──────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  const backups = await listBackups();
  res.json({ backups, total: backups.length });
});

// ── POST /api/backup/run — dispara um backup agora ──────────────────────────
router.post('/run', async (_req: Request, res: Response) => {
  try {
    const result = await runBackup();
    if (!result.ok) { res.status(400).json(result); return; }
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

export default router;
