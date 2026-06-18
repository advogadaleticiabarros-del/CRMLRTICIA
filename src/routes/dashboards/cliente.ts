import { Router, Request, Response } from 'express';
import { db } from '../../config/database';

const router = Router();

// GET /api/dashboards/cliente/:clientId
router.get('/:clientId', async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;

    const [[processos]] = await db.query(
      "SELECT COUNT(*) AS ativos FROM cases WHERE client_id = ? AND status = 'ativo'",
      [clientId]
    ) as any;

    const [prazosProximos] = await db.query(`
      SELECT d.id, d.description, d.deadline_date, tdc.days_remaining, tdc.status_label
      FROM deadlines d
      LEFT JOIN task_deadline_counters tdc ON tdc.deadline_id = d.id
      WHERE d.client_id = ? AND d.status = 'pendente'
        AND d.deadline_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 14 DAY)
      ORDER BY d.deadline_date ASC
      LIMIT 10
    `, [clientId]) as any;

    const [tarefasPendentes] = await db.query(`
      SELECT t.id, t.title, t.due_date, t.priority, tdc.days_remaining, tdc.status_label
      FROM tasks t
      LEFT JOIN task_deadline_counters tdc ON tdc.task_id = t.id
      WHERE t.client_id = ?  AND t.status NOT IN ('concluida', 'cancelada')
      ORDER BY t.due_date ASC
      LIMIT 10
    `, [clientId]) as any;

    const [[documentos]] = await db.query(
      "SELECT COUNT(*) AS pendentes FROM documents WHERE client_id = ? AND status = 'pendente'",
      [clientId]
    ) as any;

    const [propostas] = await db.query(
      "SELECT id, title, valor, status FROM propostas WHERE client_id = ? AND status IN ('enviada', 'em_negociacao') ORDER BY created_at DESC",
      [clientId]
    ) as any;

    const [[financeiro]] = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'pendente' THEN valor END), 0) AS a_receber,
        COALESCE(SUM(CASE WHEN status = 'vencido'  THEN valor END), 0) AS vencido
      FROM installments WHERE client_id = ?
    `, [clientId]) as any;

    const [historico] = await db.query(`
      (SELECT 'movimento' AS tipo, description AS descricao, created_at FROM case_movements WHERE client_id = ? ORDER BY created_at DESC LIMIT 5)
      UNION ALL
      (SELECT 'pagamento'  AS tipo, CONCAT('R$ ', valor) AS descricao, paid_at AS created_at FROM installments WHERE client_id = ? AND status = 'pago' ORDER BY paid_at DESC LIMIT 5)
      ORDER BY created_at DESC LIMIT 10
    `, [clientId, clientId]) as any;

    res.json({
      processos_ativos:     processos.ativos,
      prazos_proximos:      prazosProximos,
      tarefas_pendentes:    tarefasPendentes,
      documentos_pendentes: documentos.pendentes,
      propostas_em_aberto:  propostas,
      financeiro: {
        a_receber:       financeiro.a_receber,
        parcelas_vencidas: financeiro.vencido,
      },
      historico_recente: historico,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar dashboard do cliente' });
  }
});

export default router;
