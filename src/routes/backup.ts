import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { runBackup, listBackups, listLocalBackups, getLatestLocalBackupPath } from '../services/backupService';

const router = Router();

// ── GET /api/backup — lista os backups no MEGA e localmente ────────────────
router.get('/', async (_req: Request, res: Response) => {
  const backups = await listBackups();
  const local = listLocalBackups();
  res.json({ backups, total: backups.length, local, totalLocal: local.length });
});

// ── POST /api/backup/run — dispara um backup agora (MEGA + local) ──────────
router.post('/run', async (_req: Request, res: Response) => {
  try {
    const result = await runBackup();
    const okAoMenosUm = result.mega.ok || result.local.ok;
    res.status(okAoMenosUm ? 200 : 400).json(result);
  } catch (e: any) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// ── GET /api/backup/download-local — baixa o backup local mais recente ─────
// O arquivo permanece CIFRADO (mesma postura de encryptBuffer) — não decifra
// no servidor antes de entregar; quem baixar precisa da ENCRYPTION_KEY para
// abrir, igual a qualquer outro backup.
router.get('/download-local', (_req: Request, res: Response) => {
  const caminho = getLatestLocalBackupPath();
  if (!caminho || !fs.existsSync(caminho)) {
    res.status(404).json({ error: 'Nenhum backup local disponível' });
    return;
  }
  res.download(caminho, path.basename(caminho));
});

export default router;
