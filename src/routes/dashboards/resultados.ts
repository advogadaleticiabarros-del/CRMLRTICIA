import { Router, Request, Response } from 'express';
import { db } from '../../config/database';
import { montarRelatorioResultados } from '../../services/resultadoProcessos';

const router = Router();

// GET /api/dashboards/resultados — "Resultado por processo".
// Busca os casos ajuizados (com número de processo) e entrega à regra pura
// montarRelatorioResultados: taxa de sucesso, % obtido e provisão.
router.get('/', async (_req: Request, res: Response) => {
  const [rows] = await db.query(`
    SELECT c.id, c.title, c.case_number, c.legal_area, c.status, c.resultado, c.resultado_em,
           c.valor_causa, c.valor_obtido, c.polo_cliente,
           cl.name AS client_name, p.name AS partner_name,
           (COALESCE(c.production_labels,'') LIKE '%dativo%'
             OR EXISTS (SELECT 1 FROM dative_cases dc WHERE dc.case_id = c.id)) AS dativo,
           -- parte do escritório: 30% próprio; em parceria, êxito% × (100 − parte do parceiro)%
           CASE WHEN p.id IS NULL THEN 30
                ELSE p.success_fee_percent * (100 - p.partner_split_percent) / 100 END AS fee_pct,
           -- Honorários SÓ DA SUA PARTE (07/10/2026): em caso de parceria, desconta a
           -- parte da parceira (exceto a entrada, que é do escritório); inclui RPV/alvará.
           ((SELECT COALESCE(SUM(fr.valor * (CASE WHEN p.id IS NULL OR fr.description LIKE 'Entrada%' THEN 1 ELSE (100 - p.partner_split_percent) / 100 END)),0)
               FROM financial_records fr
              WHERE fr.tipo = 'receita' AND fr.status = 'pago'
                AND (fr.case_id = c.id OR fr.agreement_id IN (SELECT a.id FROM agreements a WHERE a.case_id = c.id)))
            + (SELECT COALESCE(SUM(aw.valor_escritorio * (CASE WHEN p.id IS NULL THEN 1 ELSE (100 - p.partner_split_percent) / 100 END)),0)
                 FROM case_awards aw WHERE aw.case_id = c.id AND aw.status = 'recebido')) AS honorarios_recebidos,
           ((SELECT COALESCE(SUM(fr.valor * (CASE WHEN p.id IS NULL OR fr.description LIKE 'Entrada%' THEN 1 ELSE (100 - p.partner_split_percent) / 100 END)),0)
               FROM financial_records fr
              WHERE fr.tipo = 'receita' AND fr.status = 'pendente'
                AND (fr.case_id = c.id OR fr.agreement_id IN (SELECT a.id FROM agreements a WHERE a.case_id = c.id)))
            + (SELECT COALESCE(SUM(aw.valor_escritorio * (CASE WHEN p.id IS NULL THEN 1 ELSE (100 - p.partner_split_percent) / 100 END)),0)
                 FROM case_awards aw WHERE aw.case_id = c.id AND aw.status = 'aguardando')) AS honorarios_a_receber,
           (SELECT COALESCE(SUM(r.valor),0) FROM repasses r WHERE r.case_id = c.id AND r.status <> 'cancelado') AS repasse_parceiro
      FROM cases c
      JOIN clients cl ON cl.id = c.client_id
      LEFT JOIN partners p ON p.id = c.partner_id
     WHERE c.case_number IS NOT NULL AND c.case_number <> ''
       AND COALESCE(c.production_stage,'') <> 'recusado'
     ORDER BY c.resultado IS NULL, c.resultado_em DESC, cl.name`) as any;

  const casos = rows.map((r: any) => ({
    ...r,
    dativo: !!Number(r.dativo),
    fee_pct: Number(r.fee_pct),
    honorarios_recebidos: Number(r.honorarios_recebidos),
    honorarios_a_receber: Number(r.honorarios_a_receber),
    repasse_parceiro: Number(r.repasse_parceiro),
  }));
  res.json(montarRelatorioResultados(casos));
});

export default router;
