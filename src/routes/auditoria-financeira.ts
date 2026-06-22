import { Router, Request, Response } from 'express';
import { db } from '../config/database';

const router = Router();

// ── GET /api/auditoria-financeira — trilha de auditoria com filtros ─────────
router.get('/', async (req: Request, res: Response) => {
  const { entity_type, action } = req.query as Record<string, string>;
  const entityId = req.query.entity_id as string;
  const userId = req.query.user_id as string;
  const startDate = req.query.start_date as string;
  const endDate = req.query.end_date as string;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
  const offset = (page - 1) * limit;

  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (entity_type) { where.push('entity_type = ?'); params.push(entity_type); }
  if (action) { where.push('action = ?'); params.push(action); }
  if (entityId) { where.push('entity_id = ?'); params.push(entityId); }
  if (userId) { where.push('user_id = ?'); params.push(userId); }
  if (startDate) { where.push('created_at >= ?'); params.push(startDate); }
  if (endDate) { where.push('created_at <= ?'); params.push(endDate); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM financial_audit_logs ${whereSql}`, params) as any;
  const [rows] = await db.query(
    `SELECT * FROM financial_audit_logs ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as any;

  res.json({ data: rows, total, page, limit, pages: Math.ceil(total / limit) });
});

// ── GET /api/auditoria-financeira/stats — resumo por ação/entidade ──────────
router.get('/stats', async (_req: Request, res: Response) => {
  const [[tot]] = await db.query('SELECT COUNT(*) AS total_registros FROM financial_audit_logs') as any;
  const [byAction] = await db.query('SELECT action, COUNT(*) AS qtd FROM financial_audit_logs GROUP BY action') as any;
  const [byEntity] = await db.query('SELECT entity_type, COUNT(*) AS qtd FROM financial_audit_logs GROUP BY entity_type') as any;

  const porAcao: Record<string, number> = {};
  for (const r of byAction) porAcao[r.action] = Number(r.qtd);
  const porEntidade: Record<string, number> = {};
  for (const r of byEntity) porEntidade[r.entity_type] = Number(r.qtd);

  res.json({ total_registros: Number(tot.total_registros), por_acao: porAcao, por_entidade: porEntidade });
});

export default router;
