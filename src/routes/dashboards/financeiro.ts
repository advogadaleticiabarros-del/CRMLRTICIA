import { Router, Request, Response } from 'express';
import { db } from '../../config/database';

const router = Router();

// GET /api/dashboards/financeiro/projecao-mes — Resumo do mês atual (entradas/saídas, realizado/previsto)
// ANTES ESTAVA INCOMPLETO: só financial_records + correspondente, filtrados por
// user_id. Agora delega ao cashflowService, que consolida TODAS as fontes
// (dativas, correspondente, parcelas, contratos, repasses, acordos, manuais).
router.get('/projecao-mes', async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const { getMonthlyCashflow } = await import('../../services/cashflowService');
    const cx = await getMonthlyCashflow(mesAtual, 1);
    const m = cx.meses[0];
    res.json({
      mes: mesAtual,
      entrada_realizado: m.entrada_realizado,
      entrada_previsto: m.entrada_previsto,
      saida_realizado: m.saida_realizado,
      saida_previsto: m.saida_previsto,
      saldo_realizado: m.saldo_realizado,
      saldo_previsto: m.saldo_previsto,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar projeção do mês' });
  }
});

// GET /api/dashboards/financeiro
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    // Recebimentos e despesas (financial_records)
    const [[fluxo]] = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo = 'receita' AND status = 'pendente' THEN valor END), 0)  AS recebimentos_previstos,
        COALESCE(SUM(CASE WHEN tipo = 'receita' AND status = 'pago'     THEN valor END), 0)  AS recebimentos_realizados,
        COALESCE(SUM(CASE WHEN tipo = 'despesa' AND status = 'pendente' THEN valor END), 0)  AS despesas_previstas,
        COALESCE(SUM(CASE WHEN tipo = 'despesa' AND status = 'pago'     THEN valor END), 0)  AS despesas_pagas,
        COALESCE(SUM(CASE WHEN tipo = 'receita' AND status = 'vencido'  THEN valor END), 0)  AS inadimplencia
      FROM financial_records WHERE user_id = ?
    `, [userId]) as any;

    // Parcelas de installments (contas a receber)
    const [[parcelas]] = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status IN ('pendente','pago') THEN valor END), 0) AS parc_previstos,
        COALESCE(SUM(CASE WHEN status = 'pago' THEN valor END), 0) AS parc_realizados
      FROM installments WHERE user_id = ?
    `, [userId]) as any;

    // Audiências de correspondente (contas a receber)
    const [[audiencias]] = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status IN ('agendada','realizada','faturada') THEN value END), 0) AS aud_previstos,
        COALESCE(SUM(CASE WHEN status = 'paga' THEN value END), 0) AS aud_realizados
      FROM correspondent_hearings WHERE user_id = ?
    `, [userId]) as any;

    // Totalizados: financial_records + installments + correspondent_hearings
    const recebimentos_previstos = Number(fluxo.recebimentos_previstos) + Number(parcelas.parc_previstos) + Number(audiencias.aud_previstos);
    const recebimentos_realizados = Number(fluxo.recebimentos_realizados) + Number(parcelas.parc_realizados) + Number(audiencias.aud_realizados);

    const despesas_previstas = fluxo.despesas_previstas;
    const despesas_pagas = fluxo.despesas_pagas;
    const saldo_previsto   = recebimentos_previstos - despesas_previstas;
    const saldo_realizado  = recebimentos_realizados - despesas_pagas;

    // Previsão próximos 3/6/12 meses (financial_records + correspondent_hearings)
    const [previsao] = await db.query(`
      SELECT mes, SUM(receitas) AS receitas, SUM(despesas) AS despesas
      FROM (
        SELECT DATE_FORMAT(due_date, '%Y-%m') AS mes,
          SUM(CASE WHEN tipo = 'receita' THEN valor ELSE 0 END) AS receitas,
          SUM(CASE WHEN tipo = 'despesa' THEN valor ELSE 0 END) AS despesas
        FROM financial_records
        WHERE user_id = ? AND status = 'pendente'
          AND due_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 12 MONTH)
        GROUP BY DATE_FORMAT(due_date, '%Y-%m')
        UNION ALL
        SELECT DATE_FORMAT(due_date, '%Y-%m') AS mes,
          SUM(value) AS receitas, 0 AS despesas
        FROM correspondent_hearings
        WHERE user_id = ? AND status IN ('agendada','realizada','faturada')
          AND due_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 12 MONTH)
        GROUP BY DATE_FORMAT(due_date, '%Y-%m')
      ) combined
      GROUP BY mes
      ORDER BY mes ASC
    `, [userId, userId]) as any;

    // Recorrências futuras (apenas financial_records)
    const [recorrencias] = await db.query(`
      SELECT id, description, valor, recurrence_type, next_due_date
      FROM financial_records
      WHERE user_id = ? AND recurrence_type IS NOT NULL AND status = 'pendente'
        AND next_due_date >= NOW()
      ORDER BY next_due_date ASC
      LIMIT 10
    `, [userId]) as any;

    // Resultado por centro de custo (apenas financial_records)
    const [porCentro] = await db.query(`
      SELECT cost_center,
        SUM(CASE WHEN tipo = 'receita' THEN valor ELSE 0 END) AS receitas,
        SUM(CASE WHEN tipo = 'despesa' THEN valor ELSE 0 END) AS despesas,
        SUM(CASE WHEN tipo = 'receita' THEN valor ELSE -valor END) AS resultado
      FROM financial_records
      WHERE user_id = ? AND cost_center IS NOT NULL
      GROUP BY cost_center ORDER BY resultado DESC
    `, [userId]) as any;

    // Resultado por área jurídica (apenas financial_records)
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
      recebimentos_previstos: Math.round(recebimentos_previstos * 100) / 100,
      recebimentos_realizados: Math.round(recebimentos_realizados * 100) / 100,
      despesas_previstas: Math.round(despesas_previstas * 100) / 100,
      despesas_pagas: Math.round(despesas_pagas * 100) / 100,
      saldo_previsto: Math.round(saldo_previsto * 100) / 100,
      saldo_realizado: Math.round(saldo_realizado * 100) / 100,
      inadimplencia: Math.round(fluxo.inadimplencia * 100) / 100,
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
