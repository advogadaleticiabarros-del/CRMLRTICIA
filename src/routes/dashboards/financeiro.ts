import { Router, Request, Response } from 'express';
import { db } from '../../config/database';

const router = Router();

// GET /api/dashboards/financeiro
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    // Recebimentos e despesas
    const [[fluxo]] = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo = 'receita' AND status = 'pendente' THEN valor END), 0)  AS recebimentos_previstos,
        COALESCE(SUM(CASE WHEN tipo = 'receita' AND status = 'pago'     THEN valor END), 0)  AS recebimentos_realizados,
        COALESCE(SUM(CASE WHEN tipo = 'despesa' AND status = 'pendente' THEN valor END), 0)  AS despesas_previstas,
        COALESCE(SUM(CASE WHEN tipo = 'despesa' AND status = 'pago'     THEN valor END), 0)  AS despesas_pagas,
        COALESCE(SUM(CASE WHEN tipo = 'receita' AND status = 'vencido'  THEN valor END), 0)  AS inadimplencia
      FROM financial_records WHERE user_id = ?
    `, [userId]) as any;

    const saldo_previsto   = fluxo.recebimentos_previstos   - fluxo.despesas_previstas;
    const saldo_realizado  = fluxo.recebimentos_realizados  - fluxo.despesas_pagas;

    // Previsão próximos 3/6/12 meses
    const [previsao] = await db.query(`
      SELECT
        DATE_FORMAT(due_date, '%Y-%m') AS mes,
        SUM(CASE WHEN tipo = 'receita' THEN valor ELSE 0 END) AS receitas,
        SUM(CASE WHEN tipo = 'despesa' THEN valor ELSE 0 END) AS despesas
      FROM financial_records
      WHERE user_id = ? AND status = 'pendente'
        AND due_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 12 MONTH)
      GROUP BY mes
      ORDER BY mes ASC
    `, [userId]) as any;

    // Recorrências futuras
    const [recorrencias] = await db.query(`
      SELECT id, description, valor, recurrence_type, next_due_date
      FROM financial_records
      WHERE user_id = ? AND recurrence_type IS NOT NULL AND status = 'pendente'
        AND next_due_date >= NOW()
      ORDER BY next_due_date ASC
      LIMIT 10
    `, [userId]) as any;

    // Resultado por centro de custo
    const [porCentro] = await db.query(`
      SELECT cost_center,
        SUM(CASE WHEN tipo = 'receita' THEN valor ELSE 0 END) AS receitas,
        SUM(CASE WHEN tipo = 'despesa' THEN valor ELSE 0 END) AS despesas,
        SUM(CASE WHEN tipo = 'receita' THEN valor ELSE -valor END) AS resultado
      FROM financial_records
      WHERE user_id = ? AND cost_center IS NOT NULL
      GROUP BY cost_center ORDER BY resultado DESC
    `, [userId]) as any;

    // Resultado por área jurídica
    const [porArea] = await db.query(`
      SELECT c.legal_area,
        SUM(CASE WHEN fr.tipo = 'receita' THEN fr.valor ELSE 0 END) AS receitas,
        SUM(CASE WHEN fr.tipo = 'despesa' THEN fr.valor ELSE 0 END) AS despesas
      FROM financial_records fr
      LEFT JOIN cases c ON c.id = fr.case_id
      WHERE fr.user_id = ? AND c.legal_area IS NOT NULL
      GROUP BY c.legal_area ORDER BY receitas DESC
    `, [userId]) as any;

    res.json({
      recebimentos_previstos:   fluxo.recebimentos_previstos,
      recebimentos_realizados:  fluxo.recebimentos_realizados,
      despesas_previstas:       fluxo.despesas_previstas,
      despesas_pagas:           fluxo.despesas_pagas,
      saldo_previsto,
      saldo_realizado,
      inadimplencia:            fluxo.inadimplencia,
      previsao_mensal:          previsao,
      previsao_3_meses:         previsao.slice(0, 3),
      previsao_6_meses:         previsao.slice(0, 6),
      recorrencias_futuras:     recorrencias,
      resultado_por_centro:     porCentro,
      resultado_por_area:       porArea,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar dashboard financeiro' });
  }
});

export default router;
