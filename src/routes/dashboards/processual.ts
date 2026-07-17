import { Router, Request, Response } from 'express';
import { db } from '../../config/database';

const router = Router();

// GET /api/dashboards/processual
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    const [[totais]] = await db.query(`
      SELECT
        SUM(status = 'ativo')   AS ativos,
        SUM(status = 'suspenso') AS suspensos,
        SUM(status = 'encerrado') AS encerrados
      FROM cases WHERE user_id = ?
    `, [userId]) as any;

    const [porArea] = await db.query(
      'SELECT legal_area, COUNT(*) AS total FROM cases WHERE user_id = ? AND status = "ativo" GROUP BY legal_area ORDER BY total DESC',
      [userId]
    ) as any;

    const [porFase] = await db.query(
      'SELECT phase, COUNT(*) AS total FROM cases WHERE user_id = ? AND status = "ativo" GROUP BY phase ORDER BY total DESC',
      [userId]
    ) as any;

    const [movimentacoes] = await db.query(`
      SELECT m.id, m.description, m.created_at, c.case_number, c.client_id, cl.name AS client_name
      FROM case_movements m
      JOIN cases c ON c.id = m.case_id
      JOIN clients cl ON cl.id = c.client_id
      WHERE c.user_id = ?
      ORDER BY m.created_at DESC
      LIMIT 10
    `, [userId]) as any;

    const [prazosProximos] = await db.query(`
      SELECT d.id, d.description, d.deadline_date, tdc.days_remaining, tdc.status_label,
             c.case_number, cl.name AS client_name
      FROM deadlines d
      JOIN cases c ON c.id = d.case_id
      JOIN clients cl ON cl.id = c.client_id
      LEFT JOIN task_deadline_counters tdc ON tdc.deadline_id = d.id
      WHERE c.user_id = ? AND d.status = 'pendente' AND tdc.status_label IN ('urgente','atencao','normal')
      ORDER BY d.deadline_date ASC
      LIMIT 15
    `, [userId]) as any;

    const [prazosVencidos] = await db.query(`
      SELECT d.id, d.description, d.deadline_date, c.case_number, cl.name AS client_name
      FROM deadlines d
      JOIN cases c ON c.id = d.case_id
      JOIN clients cl ON cl.id = c.client_id
      LEFT JOIN task_deadline_counters tdc ON tdc.deadline_id = d.id
      WHERE c.user_id = ? AND tdc.status_label = 'vencido'
      ORDER BY d.deadline_date ASC
    `, [userId]) as any;

    const [audiencias] = await db.query(`
      SELECT ce.id, ce.title, ce.start_datetime, ce.location,
             c.case_number, cl.name AS client_name
      FROM calendar_events ce
      JOIN cases c ON c.id = ce.case_id
      JOIN clients cl ON cl.id = c.client_id
      WHERE ce.user_id = ? AND ce.event_type = 'audiencia' AND ce.start_datetime >= NOW()
      ORDER BY ce.start_datetime ASC
      LIMIT 10
    `, [userId]) as any;

    // ANTES: contava `legal_pieces`, tabela MORTA — nenhum código insere nela.
    // O KPI "peças pendentes" mostrava ZERO para sempre, mesmo com a esteira cheia.
    // A produção real vive em cases.production_stage.
    const [[pecas]] = await db.query(`
      SELECT COUNT(*) AS pendentes FROM cases
       WHERE production_stage IN ('em_analise','separacao_documentos','criacao_inicial','revisao_inicial','aguardando_protocolo')
    `) as any;

    res.json({
      totais,
      processos_por_area:   porArea,
      processos_por_fase:   porFase,
      movimentacoes_recentes: movimentacoes,
      prazos_proximos:      prazosProximos,
      prazos_vencidos:      prazosVencidos,
      audiencias_agendadas: audiencias,
      pecas_pendentes:      pecas.pendentes,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar dashboard processual' });
  }
});

export default router;
