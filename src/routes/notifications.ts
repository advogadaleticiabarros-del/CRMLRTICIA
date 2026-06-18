import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { notificationService } from '../services/NotificationService';
import { runNotificationChecks } from '../crons';

const router = Router();

// GET /api/notifications — lista não lidas
router.get('/', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const items = await notificationService.getUnread(userId);
  res.json(items);
});

// GET /api/notifications/count — contador de não lidas (para o sino)
router.get('/count', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const items = await notificationService.getUnread(userId);
  res.json({ count: items.length });
});

// POST /api/notifications/check — roda as checagens de alerta agora
router.post('/check', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  await runNotificationChecks();
  const items = await notificationService.getUnread(userId);
  res.json({ success: true, unread: items.length });
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  await notificationService.markAsRead(Number(req.params.id), userId);
  res.json({ success: true });
});

// PATCH /api/notifications/read-all
router.patch('/read-all', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  await db.query(
    "UPDATE notifications SET status = 'lida' WHERE user_id = ? AND status IN ('pendente','enviada')",
    [userId]
  );
  res.json({ success: true });
});

// GET /api/notifications/settings — cria padrão se não existir
router.get('/settings', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  let settings = await notificationService.getSettings(userId);
  if (!settings) {
    await notificationService.updateSettings(userId, {});
    settings = await notificationService.getSettings(userId);
  }
  res.json(settings);
});

// PUT /api/notifications/settings
router.put('/settings', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  await notificationService.updateSettings(userId, req.body);
  res.json({ success: true });
});

// GET /api/notifications/telegram
router.get('/telegram', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const [rows] = await db.query(
    'SELECT id, chat_id, enabled FROM telegram_settings WHERE user_id = ?',
    [userId]
  ) as any;
  res.json(rows[0] ?? { chat_id: null, enabled: false });
});

// PUT /api/notifications/telegram
router.put('/telegram', async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { bot_token, chat_id, enabled } = req.body;

  await db.query(
    `INSERT INTO telegram_settings (user_id, bot_token, chat_id, enabled)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE bot_token = VALUES(bot_token), chat_id = VALUES(chat_id), enabled = VALUES(enabled)`,
    [userId, bot_token, chat_id, enabled ? 1 : 0]
  );
  res.json({ success: true });
});

export default router;
