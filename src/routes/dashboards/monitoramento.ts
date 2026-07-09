import { Router, Request, Response } from 'express';
import { db } from '../../config/database';

const router = Router();

// GET /api/dashboards/monitoramento — indicadores dos processos buscados (OAB/DJEN)
router.get('/', async (_req: Request, res: Response) => {
  const [[kpi]] = await db.query(`
    SELECT COUNT(*) AS total,
           SUM(status = 'ativo') AS ativos,
           SUM(last_movement_at >= NOW() - INTERVAL 30 DAY) AS com_mov_30d,
           SUM(last_movement_at >= NOW() - INTERVAL 7 DAY)  AS com_mov_7d,
           COUNT(DISTINCT court) AS tribunais
      FROM legal_processes`) as any;

  const [[mv]] = await db.query('SELECT COUNT(*) AS total FROM process_movements') as any;
  const [[pz]] = await db.query("SELECT COUNT(*) AS total FROM detected_deadlines WHERE status = 'a_confirmar'") as any;
  const [[cli]] = await db.query('SELECT COUNT(DISTINCT client_id) AS total FROM legal_processes WHERE client_id IS NOT NULL') as any;

  const [porTribunal] = await db.query(
    "SELECT COALESCE(NULLIF(court,''),'—') AS court, COUNT(*) AS total FROM legal_processes GROUP BY court ORDER BY total DESC LIMIT 14"
  ) as any;

  const [porTipo] = await db.query(`
    SELECT CASE
      WHEN court LIKE 'TRT%' THEN 'Trabalhista'
      WHEN court LIKE 'TRF%' THEN 'Federal / Previdenciário'
      WHEN court LIKE 'TJ%'  THEN 'Estadual / Cível'
      WHEN court IN ('STJ','TST','STF','TSE') THEN 'Tribunais Superiores'
      ELSE 'Outros' END AS tipo, COUNT(*) AS total
    FROM legal_processes GROUP BY tipo ORDER BY total DESC`) as any;

  const [porMes] = await db.query(`
    SELECT DATE_FORMAT(pm.movement_date, '%Y-%m') AS mes, COUNT(*) AS total
      FROM process_movements pm
     WHERE pm.movement_date >= DATE_FORMAT(NOW() - INTERVAL 5 MONTH, '%Y-%m-01')
     GROUP BY mes ORDER BY mes`) as any;

  const [recentes] = await db.query(`
    SELECT pm.id, pm.movement_date, pm.title, lp.id AS process_id, lp.process_number, lp.court, c.name AS client_name
      FROM process_movements pm
      JOIN legal_processes lp ON lp.id = pm.process_id
      LEFT JOIN clients c ON c.id = lp.client_id
     ORDER BY pm.movement_date DESC, pm.id DESC LIMIT 15`) as any;

  const [topProcessos] = await db.query(`
    SELECT lp.id, lp.process_number, lp.court, c.name AS client_name, lp.last_movement_at,
           (SELECT COUNT(*) FROM process_movements pm WHERE pm.process_id = lp.id) AS movs
      FROM legal_processes lp LEFT JOIN clients c ON c.id = lp.client_id
     ORDER BY lp.last_movement_at DESC LIMIT 8`) as any;

  res.json({
    kpi: { ...kpi, movimentacoes: mv.total, prazos_pendentes: pz.total, clientes: cli.total },
    por_tribunal: porTribunal,
    por_tipo: porTipo,
    movimentacoes_por_mes: porMes,
    recentes,
    top_processos: topProcessos,
  });
});

export default router;
