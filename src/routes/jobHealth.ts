import { Router, Request, Response } from 'express';
import { db } from '../config/database';

const router = Router();

/**
 * Saúde das rotinas automáticas. Mostra, por rotina, a última execução e as
 * falhas recentes — para descobrir problema ANTES de sentir o sintoma.
 */

// GET /api/job-health — última execução de cada rotina + falhas nas últimas 24h
router.get('/', async (_req: Request, res: Response) => {
  try {
    const [rows] = await db.query(`
      SELECT j.job,
             j.status,
             j.message,
             j.duration_ms,
             j.ran_at,
             (SELECT COUNT(*) FROM job_runs f
               WHERE f.job = j.job AND f.status = 'erro'
                 AND f.ran_at >= NOW() - INTERVAL 24 HOUR) AS falhas_24h
        FROM job_runs j
        JOIN (SELECT job, MAX(ran_at) AS ult FROM job_runs GROUP BY job) u
          ON u.job = j.job AND u.ult = j.ran_at
       ORDER BY (j.status = 'erro') DESC, j.ran_at DESC
    `) as any;

    const comErro = rows.filter((r: any) => r.status === 'erro').length;
    res.json({
      rotinas: rows,
      total: rows.length,
      com_erro: comErro,
      saudavel: comErro === 0,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Erro ao ler a saúde das rotinas' });
  }
});

// GET /api/job-health/:job — histórico de uma rotina (últimas 50 execuções)
router.get('/:job', async (req: Request, res: Response) => {
  try {
    const [rows] = await db.query(
      'SELECT status, message, duration_ms, ran_at FROM job_runs WHERE job = ? ORDER BY ran_at DESC LIMIT 50',
      [req.params.job]
    ) as any;
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Erro ao ler o histórico' });
  }
});

export default router;
