import { Router, Request, Response } from 'express';
import { db } from '../config/database';

const router = Router();

// ── GET /api/access-logs — quem acessou a ficha de qual cliente/caso, quando ─
// Achado na pesquisa de módulos ainda não auditados (23/09/2026): a tabela
// access_logs (LGPD) é gravada desde a migration 059 toda vez que alguém
// abre a ficha completa de um cliente ou processo (ver src/services/
// accessLog.ts, chamado em clients.ts e cases.ts) — mas não existia
// nenhuma tela nem endpoint pra consultar. O próprio comentário da
// migration já previa isso: "Consulta: Configurações (admin) ou SQL direto."
router.get('/', async (req: Request, res: Response) => {
  const clientId = req.query.client_id as string;
  const caseId = req.query.case_id as string;
  const userId = req.query.user_id as string;
  const action = req.query.action as string;
  const clientName = req.query.client_name as string;
  const startDate = req.query.start_date as string;
  const endDate = req.query.end_date as string;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
  const offset = (page - 1) * limit;

  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (clientId) { where.push('al.client_id = ?'); params.push(clientId); }
  if (caseId) { where.push('al.case_id = ?'); params.push(caseId); }
  if (userId) { where.push('al.user_id = ?'); params.push(userId); }
  if (action) { where.push('al.action = ?'); params.push(action); }
  if (clientName) { where.push('cl.name LIKE ?'); params.push(`%${clientName}%`); }
  if (startDate) { where.push('al.created_at >= ?'); params.push(startDate); }
  if (endDate) { where.push('al.created_at <= ?'); params.push(endDate); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM access_logs al LEFT JOIN clients cl ON cl.id = al.client_id ${whereSql}`,
    params
  ) as any;
  const [rows] = await db.query(
    `SELECT al.*, cl.name AS client_name, c.title AS case_title, c.case_number
       FROM access_logs al
       LEFT JOIN clients cl ON cl.id = al.client_id
       LEFT JOIN cases c ON c.id = al.case_id
       ${whereSql} ORDER BY al.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as any;

  res.json({ data: rows, total, page, limit, pages: Math.ceil(total / limit) });
});

// ── GET /api/access-logs/stats — resumo por usuário e por ação ──────────────
router.get('/stats', async (_req: Request, res: Response) => {
  const [[tot]] = await db.query('SELECT COUNT(*) AS total_registros FROM access_logs') as any;
  const [[hoje]] = await db.query("SELECT COUNT(*) AS n FROM access_logs WHERE DATE(created_at) = CURDATE()") as any;
  const [porUsuario] = await db.query(
    `SELECT user_id, user_name, COUNT(*) AS qtd FROM access_logs GROUP BY user_id, user_name ORDER BY qtd DESC LIMIT 10`
  ) as any;

  res.json({
    total_registros: Number(tot.total_registros),
    acessos_hoje: Number(hoje.n),
    por_usuario: porUsuario.map((r: any) => ({ user_id: r.user_id, user_name: r.user_name, qtd: Number(r.qtd) })),
  });
});

export default router;
