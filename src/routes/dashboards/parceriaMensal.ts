import { Router, Request, Response } from 'express';
import { db } from '../../config/database';

const router = Router();

/**
 * Relatório mensal da parceria: registro do que foi PROTOCOLADO no mês.
 * Âncora = data de protocolo (cases.protocoled_at). Lista os casos protocolados
 * de parceria por mês, com valor da causa e a entrada lançada no mês.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    // Casos de parceria protocolados (ou concluídos), com data de protocolo.
    const [rows] = await db.query(`
      SELECT DATE_FORMAT(c.protocoled_at, '%Y-%m') AS mes,
             c.id, c.title, c.legal_area, c.case_number, c.protocoled_at, c.valor_causa,
             cl.id AS client_id, cl.name AS client_name,
             p.name AS partner_name
        FROM cases c
        JOIN clients  cl ON cl.id = c.client_id
        LEFT JOIN partners p ON p.id = c.partner_id
       WHERE c.partner_id IS NOT NULL
         AND c.production_stage IN ('protocolado','concluido')
         AND c.protocoled_at IS NOT NULL
       ORDER BY c.protocoled_at DESC
    `) as any;

    // Entrada da parceria lançada por mês (financial_records "Entrada parceria…").
    const [entradas] = await db.query(`
      SELECT DATE_FORMAT(created_at, '%Y-%m') AS mes, COALESCE(SUM(valor),0) AS entrada
        FROM financial_records
       WHERE tipo = 'receita' AND description LIKE 'Entrada parceria%'
       GROUP BY DATE_FORMAT(created_at, '%Y-%m')
    `) as any;
    const entradaPorMes: Record<string, number> = {};
    for (const e of entradas) entradaPorMes[e.mes] = Number(e.entrada) || 0;

    // Agrupa por mês para os totais.
    const mesesMap: Record<string, { mes: string; casos: number; clientes: Set<number>; valor_causa: number }> = {};
    for (const r of rows) {
      const m = r.mes;
      if (!mesesMap[m]) mesesMap[m] = { mes: m, casos: 0, clientes: new Set(), valor_causa: 0 };
      mesesMap[m].casos++;
      if (r.client_id) mesesMap[m].clientes.add(r.client_id);
      mesesMap[m].valor_causa += Number(r.valor_causa) || 0;
    }
    const meses = Object.values(mesesMap)
      .map((x) => ({ mes: x.mes, casos: x.casos, clientes: x.clientes.size, valor_causa: x.valor_causa, entrada: entradaPorMes[x.mes] || 0 }))
      .sort((a, b) => b.mes.localeCompare(a.mes));

    res.json({ meses, rows });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Erro ao carregar relatório da parceria' });
  }
});

export default router;
