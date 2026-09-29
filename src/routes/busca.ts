import { Router, Request, Response } from 'express';
import { db } from '../config/database';

const router = Router();

/**
 * Busca global — o "assistente de bolso" pedido pela Dra. Letícia (29/09/2026):
 * de qualquer tela, um toque abre a busca e ela já vê cliente OU processo,
 * com a ÚLTIMA MOVIMENTAÇÃO em destaque, sem precisar navegar até a ficha.
 * Uma última movimentação vem de duas fontes possíveis — a interna
 * (case_movements, lançada manualmente) e a do monitoramento automático
 * (process_movements, via legal_processes vinculado) — usa a mais recente
 * das duas, seja qual for.
 */
router.get('/', async (req: Request, res: Response) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) { res.json({ clients: [], cases: [] }); return; }
  const like = `%${q}%`;
  const soNumeros = q.replace(/\D/g, '');

  const [clients] = await db.query(
    `SELECT id, name, tipo, cpf_cnpj, phone, status
       FROM clients
      WHERE name LIKE ? OR phone LIKE ? ${soNumeros.length >= 3 ? 'OR cpf_cnpj LIKE ?' : ''}
      ORDER BY (name LIKE ?) DESC, name ASC
      LIMIT 8`,
    soNumeros.length >= 3
      ? [like, `%${soNumeros}%`, `%${soNumeros}%`, `${q}%`]
      : [like, `%${soNumeros}%`, `${q}%`]
  ) as any;

  const [cases] = await db.query(
    `SELECT c.id, c.title, c.case_number, c.legal_area, c.phase, c.status, cl.name AS client_name,
            (SELECT description FROM case_movements WHERE case_id = c.id
              ORDER BY COALESCE(movement_date, created_at) DESC LIMIT 1) AS ultima_mov_interna,
            (SELECT COALESCE(movement_date, created_at) FROM case_movements WHERE case_id = c.id
              ORDER BY COALESCE(movement_date, created_at) DESC LIMIT 1) AS ultima_mov_interna_data,
            (SELECT pm.description FROM legal_processes lp
               JOIN process_movements pm ON pm.process_id = lp.id
              WHERE lp.case_id = c.id ORDER BY COALESCE(pm.movement_date, pm.created_at) DESC LIMIT 1) AS ultima_mov_monitor,
            (SELECT COALESCE(pm.movement_date, pm.created_at) FROM legal_processes lp
               JOIN process_movements pm ON pm.process_id = lp.id
              WHERE lp.case_id = c.id ORDER BY COALESCE(pm.movement_date, pm.created_at) DESC LIMIT 1) AS ultima_mov_monitor_data
       FROM cases c
       JOIN clients cl ON cl.id = c.client_id
      WHERE c.title LIKE ? OR c.case_number LIKE ? OR cl.name LIKE ?
      ORDER BY (c.title LIKE ? OR c.case_number LIKE ?) DESC, c.updated_at DESC
      LIMIT 8`,
    [like, like, like, `${q}%`, `${q}%`]
  ) as any;

  for (const c of cases) {
    const dataInterna = c.ultima_mov_interna_data ? new Date(c.ultima_mov_interna_data).getTime() : 0;
    const dataMonitor = c.ultima_mov_monitor_data ? new Date(c.ultima_mov_monitor_data).getTime() : 0;
    if (dataMonitor > dataInterna) {
      c.ultima_movimentacao = c.ultima_mov_monitor;
      c.ultima_movimentacao_data = c.ultima_mov_monitor_data;
    } else {
      c.ultima_movimentacao = c.ultima_mov_interna;
      c.ultima_movimentacao_data = c.ultima_mov_interna_data;
    }
    delete c.ultima_mov_interna; delete c.ultima_mov_interna_data;
    delete c.ultima_mov_monitor; delete c.ultima_mov_monitor_data;
  }

  res.json({ clients, cases });
});

export default router;
