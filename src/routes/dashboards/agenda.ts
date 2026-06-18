import { Router, Request, Response } from 'express';
import { db } from '../../config/database';
import { deadlineCounterService } from '../../services/DeadlineCounterService';

const router = Router();

// GET /api/dashboards/agenda
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const today  = new Date().toISOString().split('T')[0];

    // Prazos de hoje
    const [prazosHoje] = await db.query(`
      SELECT d.id, d.description, d.deadline_date, c.case_number, tdc.hours_remaining, tdc.status_label
      FROM deadlines d
      LEFT JOIN cases c ON c.id = d.case_id
      LEFT JOIN task_deadline_counters tdc ON tdc.deadline_id = d.id
      WHERE d.status = 'pendente' AND DATE(d.deadline_date) = ?
      ORDER BY d.deadline_date ASC
    `, [today]) as any;

    // Prazos da semana
    const [prazosSemana] = await db.query(`
      SELECT d.id, d.description, d.deadline_date, c.case_number, tdc.days_remaining, tdc.status_label
      FROM deadlines d
      LEFT JOIN cases c ON c.id = d.case_id
      LEFT JOIN task_deadline_counters tdc ON tdc.deadline_id = d.id
      WHERE d.status = 'pendente'
        AND d.deadline_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)
      ORDER BY d.deadline_date ASC
    `, []) as any;

    // Prazos vencidos
    const [prazosVencidos] = await db.query(`
      SELECT d.id, d.description, d.deadline_date, c.case_number
      FROM deadlines d
      LEFT JOIN cases c ON c.id = d.case_id
      LEFT JOIN task_deadline_counters tdc ON tdc.deadline_id = d.id
      WHERE d.status = 'pendente' AND tdc.status_label = 'vencido'
      ORDER BY d.deadline_date ASC
    `, []) as any;

    // Compromissos do dia
    const [compromissosDia] = await db.query(`
      SELECT ce.id, ce.title, ce.event_type, ce.start_datetime, ce.end_datetime,
             ce.location, ce.video_link, cl.name AS client_name
      FROM calendar_events ce
      LEFT JOIN clients cl ON cl.id = ce.client_id
      WHERE ce.user_id = ? AND DATE(ce.start_datetime) = ?
      ORDER BY ce.start_datetime ASC
    `, [userId, today]) as any;

    // Reuniões futuras
    const [reunioesFuturas] = await db.query(`
      SELECT ce.id, ce.title, ce.start_datetime, ce.video_link, cl.name AS client_name
      FROM calendar_events ce
      LEFT JOIN clients cl ON cl.id = ce.client_id
      WHERE ce.user_id = ? AND ce.event_type = 'reuniao' AND ce.start_datetime > NOW()
      ORDER BY ce.start_datetime ASC
      LIMIT 10
    `, [userId]) as any;

    // Audiências
    const [audiencias] = await db.query(`
      SELECT ce.id, ce.title, ce.start_datetime, ce.location, cl.name AS client_name
      FROM calendar_events ce
      LEFT JOIN clients cl ON cl.id = ce.client_id
      WHERE ce.user_id = ? AND ce.event_type = 'audiencia' AND ce.start_datetime >= NOW()
      ORDER BY ce.start_datetime ASC
      LIMIT 10
    `, [userId]) as any;

    // Tarefas por prioridade
    const [tarefasPorPrioridade] = await db.query(`
      SELECT t.id, t.title, t.priority, t.due_date, tdc.days_remaining, tdc.status_label, cl.name AS client_name
      FROM tasks t
      LEFT JOIN task_deadline_counters tdc ON tdc.task_id = t.id
      LEFT JOIN clients cl ON cl.id = t.client_id
      WHERE t.user_id = ? AND t.status NOT IN ('concluida', 'cancelada')
      ORDER BY FIELD(t.priority, 'critica','alta','media','baixa'), t.due_date ASC
      LIMIT 20
    `, [userId]) as any;

    // Contagem regressiva por status
    const contagem = await deadlineCounterService.getDashboardAgendaSummary();

    res.json({
      prazos_hoje:          prazosHoje,
      prazos_semana:        prazosSemana,
      prazos_vencidos:      prazosVencidos,
      compromissos_dia:     compromissosDia,
      reunioes_futuras:     reunioesFuturas,
      audiencias:           audiencias,
      tarefas_por_prioridade: tarefasPorPrioridade,
      contagem_regressiva:  contagem,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar dashboard de agenda' });
  }
});

export default router;
