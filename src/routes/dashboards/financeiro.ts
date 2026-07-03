import { Router, Request, Response } from 'express';
import { db } from '../../config/database';

const router = Router();

// GET /api/dashboards/financeiro/projecao-mes — Resumo do mês atual (entradas/saídas, realizado/previsto)
router.get('/projecao-mes', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const now = new Date();
    const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const inicioMes = `${mesAtual}-01`;
    const fimMes = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const fimMesStr = fimMes.toISOString().split('T')[0];

    // Resumo do mês: realizado e previsto (entrada/saída) — financial_records
    const [[resumo]] = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo = 'receita' AND status = 'pago' AND DATE_FORMAT(paid_at, '%Y-%m') = ? THEN valor ELSE 0 END), 0) AS entrada_realizado,
        COALESCE(SUM(CASE WHEN tipo = 'receita' AND status IN ('pendente','pago') AND due_date BETWEEN ? AND ? THEN valor ELSE 0 END), 0) AS entrada_previsto,
        COALESCE(SUM(CASE WHEN tipo = 'despesa' AND status = 'pago' AND DATE_FORMAT(paid_at, '%Y-%m') = ? THEN valor ELSE 0 END), 0) AS saida_realizado,
        COALESCE(SUM(CASE WHEN tipo = 'despesa' AND status IN ('pendente','pago') AND due_date BETWEEN ? AND ? THEN valor ELSE 0 END), 0) AS saida_previsto
      FROM financial_records
      WHERE user_id = ?
    `, [mesAtual, inicioMes, fimMesStr, mesAtual, inicioMes, fimMesStr, userId]) as any;

    // Audiências de correspondente: já recebidas (paga) e a receber (realizada/faturada/agendada)
    const [[audiencias]] = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'paga' AND DATE_FORMAT(paid_at, '%Y-%m') = ? THEN value ELSE 0 END), 0) AS aud_recebido,
        COALESCE(SUM(CASE WHEN status IN ('agendada','realizada','faturada') AND due_date BETWEEN ? AND ? THEN value ELSE 0 END), 0) AS aud_previsto
      FROM correspondent_hearings
      WHERE user_id = ?
    `, [mesAtual, inicioMes, fimMesStr, userId]) as any;

    const entrada_realizado = Number(resumo.entrada_realizado) + Number(audiencias.aud_recebido);
    const entrada_previsto = Number(resumo.entrada_previsto) + Number(audiencias.aud_previsto);
    const saida_realizado = resumo.saida_realizado;
    const saida_previsto = resumo.saida_previsto;

    const saldo_realizado = entrada_realizado - saida_realizado;
    const saldo_previsto = entrada_previsto - saida_previsto;

    res.json({
      mes: mesAtual,
      entrada_realizado: Math.round(entrada_realizado * 100) / 100,
      entrada_previsto: Math.round(entrada_previsto * 100) / 100,
      saida_realizado: Math.round(saida_realizado * 100) / 100,
      saida_previsto: Math.round(saida_previsto * 100) / 100,
      saldo_realizado: Math.round(saldo_realizado * 100) / 100,
      saldo_previsto: Math.round(saldo_previsto * 100) / 100,
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
