import { Router, Request, Response } from 'express';
import { db } from '../../config/database';

const router = Router();

// GET /api/dashboards/producao
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    const [[statusPecas]] = await db.query(`
      SELECT
        SUM(status = 'rascunho')    AS rascunho,
        SUM(status = 'producao')    AS producao,
        SUM(status = 'revisao')     AS revisao,
        SUM(status = 'finalizado')  AS finalizado,
        SUM(status = 'protocolado') AS protocolado
      FROM legal_pieces WHERE user_id = ?
    `, [userId]) as any;

    const [produtividadePorResponsavel] = await db.query(`
      SELECT
        u.name AS responsavel,
        COUNT(*) AS total,
        SUM(lp.status = 'finalizado' OR lp.status = 'protocolado') AS concluidas,
        SUM(lp.status IN ('rascunho','producao','revisao')) AS em_andamento
      FROM legal_pieces lp
      JOIN users u ON u.id = lp.user_id
      WHERE lp.user_id = ? AND lp.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY u.id, u.name
      ORDER BY total DESC
    `, [userId]) as any;

    const [pecasVencendo] = await db.query(`
      SELECT lp.id, lp.title, lp.type, lp.due_date, lp.status,
             c.case_number, cl.name AS client_name,
             tdc.days_remaining, tdc.status_label
      FROM legal_pieces lp
      LEFT JOIN cases c ON c.id = lp.case_id
      LEFT JOIN clients cl ON cl.id = c.client_id
      LEFT JOIN task_deadline_counters tdc ON tdc.task_id = lp.task_id
      WHERE lp.user_id = ?
        AND lp.status NOT IN ('protocolado','cancelado')
        AND lp.due_date IS NOT NULL
        AND lp.due_date <= DATE_ADD(NOW(), INTERVAL 7 DAY)
      ORDER BY lp.due_date ASC
      LIMIT 10
    `, [userId]) as any;

    res.json({
      pecas_por_status:           statusPecas,
      produtividade_por_responsavel: produtividadePorResponsavel,
      pecas_vencendo_prazo:       pecasVencendo,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar dashboard de produção jurídica' });
  }
});

export default router;
