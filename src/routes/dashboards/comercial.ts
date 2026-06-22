import { Router, Request, Response } from 'express';
import { db } from '../../config/database';

const router = Router();

// GET /api/dashboards/comercial
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    const [[metrics]] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM leads WHERE user_id = ? AND DATE(created_at) = CURDATE())                             AS leads_hoje,
        (SELECT COUNT(*) FROM leads WHERE user_id = ?)                                                              AS leads_total,
        (SELECT COUNT(*) FROM propostas WHERE user_id = ? AND status = 'enviada')                                   AS propostas_enviadas,
        (SELECT COUNT(*) FROM propostas WHERE user_id = ? AND status = 'aceita')                                    AS propostas_aceitas,
        (SELECT COUNT(*) FROM propostas WHERE user_id = ? AND status IN ('enviada','aceita')) AS total_propostas_analisaveis,
        (SELECT COALESCE(SUM(valor), 0) FROM propostas WHERE user_id = ? AND status = 'enviada')                    AS valor_potencial_aberto,
        (SELECT COUNT(*) FROM calendar_events WHERE user_id = ? AND event_type = 'reuniao' AND start_datetime >= NOW()) AS reunioes_marcadas,
        (SELECT COUNT(*) FROM propostas WHERE user_id = ? AND status = 'enviada' AND DATE(validade) BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)) AS propostas_vencendo
    `, Array(8).fill(userId)) as any;

    const [leadsPorStatus] = await db.query(
      'SELECT status, COUNT(*) AS total FROM leads WHERE user_id = ? GROUP BY status ORDER BY total DESC',
      [userId]
    ) as any;

    const [porOrigem] = await db.query(
      "SELECT COALESCE(NULLIF(source,''),'(sem origem)') AS origem, COUNT(*) AS total FROM leads WHERE user_id = ? GROUP BY origem ORDER BY total DESC",
      [userId]
    ) as any;

    const [porArea] = await db.query(
      "SELECT COALESCE(NULLIF(legal_area,''),'(indefinida)') AS area, COUNT(*) AS total FROM leads WHERE user_id = ? GROUP BY area ORDER BY total DESC",
      [userId]
    ) as any;

    const [[fin]] = await db.query(`
      SELECT
        (SELECT COALESCE(SUM(valor),0) FROM propostas WHERE user_id = ? AND status = 'enviada')                AS receita_prevista,
        (SELECT COALESCE(SUM(valor),0) FROM propostas WHERE user_id = ? AND status = 'aceita')                 AS receita_fechada,
        (SELECT COALESCE(AVG(valor),0) FROM propostas WHERE user_id = ? AND status = 'aceita' AND valor > 0)   AS ticket_medio,
        (SELECT COALESCE(SUM(estimated_value),0) FROM leads WHERE user_id = ? AND estimated_value IS NOT NULL
           AND status NOT IN ('fechada','convertido','perdida'))                                               AS pipeline_estimado
    `, Array(4).fill(userId)) as any;

    const taxa_conversao = metrics.total_propostas_analisaveis > 0
      ? ((metrics.propostas_aceitas / metrics.total_propostas_analisaveis) * 100).toFixed(1)
      : '0.0';

    res.json({
      leads_hoje:          metrics.leads_hoje,
      leads_total:         metrics.leads_total,
      leads_por_status:    leadsPorStatus,
      por_origem:          porOrigem,
      por_area:            porArea,
      propostas_enviadas:  metrics.propostas_enviadas,
      propostas_aceitas:   metrics.propostas_aceitas,
      taxa_conversao:      `${taxa_conversao}%`,
      valor_potencial_aberto: metrics.valor_potencial_aberto,
      receita_prevista:    fin.receita_prevista,
      receita_fechada:     fin.receita_fechada,
      ticket_medio:        fin.ticket_medio,
      pipeline_estimado:   fin.pipeline_estimado,
      reunioes_marcadas:   metrics.reunioes_marcadas,
      propostas_vencendo:  metrics.propostas_vencendo,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar dashboard comercial' });
  }
});

export default router;
