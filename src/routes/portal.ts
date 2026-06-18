import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../config/database';

const router = Router();

// Carrega o client_id do usuário logado. Bloqueia quem não está vinculado a um cliente.
async function loadClientId(req: Request, res: Response, next: NextFunction): Promise<void> {
  const [rows] = await db.query('SELECT client_id FROM users WHERE id = ?', [req.user!.id]) as any;
  const clientId = rows[0]?.client_id;
  if (!clientId) {
    res.status(403).json({ error: 'Acesso ao portal disponível apenas para clientes vinculados' });
    return;
  }
  (req as any).clientId = clientId;
  next();
}

router.use(loadClientId);

// ── GET /api/portal/me — resumo do cliente ──────────────────────────────────
router.get('/me', async (req: Request, res: Response) => {
  const clientId = (req as any).clientId;
  const [client] = await db.query('SELECT id, name, email, phone FROM clients WHERE id = ?', [clientId]) as any;
  const [[resumo]] = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM cases WHERE client_id = ? AND status = 'ativo') AS processos_ativos,
      (SELECT COALESCE(SUM(valor),0) FROM installments WHERE client_id = ? AND status = 'pendente') AS a_pagar,
      (SELECT COALESCE(SUM(valor),0) FROM installments WHERE client_id = ? AND status = 'pendente' AND due_date < CURDATE()) AS vencido
  `, [clientId, clientId, clientId]) as any;
  res.json({ ...client[0], resumo });
});

// ── GET /api/portal/cases — meus processos ──────────────────────────────────
router.get('/cases', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT id, case_number, title, legal_area, phase, status, created_at
     FROM cases WHERE client_id = ? ORDER BY created_at DESC`,
    [(req as any).clientId]
  ) as any;
  res.json(rows);
});

// ── GET /api/portal/cases/:id — andamento do processo (somente se for meu) ──
router.get('/cases/:id', async (req: Request, res: Response) => {
  const clientId = (req as any).clientId;
  const [rows] = await db.query(
    'SELECT id, case_number, title, legal_area, phase, status FROM cases WHERE id = ? AND client_id = ?',
    [req.params.id, clientId]
  ) as any;
  if (!rows.length) { res.status(404).json({ error: 'Processo não encontrado' }); return; }

  const [movements] = await db.query(
    'SELECT description, movement_date, created_at FROM case_movements WHERE case_id = ? ORDER BY COALESCE(movement_date, created_at) DESC LIMIT 50',
    [req.params.id]
  ) as any;

  res.json({ ...rows[0], movements });
});

// ── GET /api/portal/financial — meus valores a pagar ────────────────────────
router.get('/financial', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT i.numero, i.valor, i.due_date, i.status, p.title AS proposta,
            CASE WHEN i.status = 'pendente' AND i.due_date < CURDATE() THEN 1 ELSE 0 END AS vencida
     FROM installments i
     LEFT JOIN propostas p ON p.id = i.proposta_id
     WHERE i.client_id = ? ORDER BY i.due_date ASC`,
    [(req as any).clientId]
  ) as any;
  res.json(rows);
});

export default router;
