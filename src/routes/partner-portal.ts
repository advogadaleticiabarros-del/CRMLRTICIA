import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../config/database';

const router = Router();

// Carrega o partner_id do usuário logado. Bloqueia quem não está vinculado a um parceiro.
async function loadPartnerId(req: Request, res: Response, next: NextFunction): Promise<void> {
  const [rows] = await db.query('SELECT partner_id FROM users WHERE id = ?', [req.user!.id]) as any;
  const partnerId = rows[0]?.partner_id;
  if (!partnerId) {
    res.status(403).json({ error: 'Acesso ao portal do parceiro disponível apenas para parceiros vinculados' });
    return;
  }
  (req as any).partnerId = partnerId;
  next();
}
router.use(loadPartnerId);

// ── GET /api/partner-portal/me — resumo do parceiro ─────────────────────────
router.get('/me', async (req: Request, res: Response) => {
  const partnerId = (req as any).partnerId;
  const [[p]] = await db.query(
    'SELECT id, name, success_fee_percent, partner_split_percent, sucumbencia_split_percent FROM partners WHERE id = ?',
    [partnerId]) as any;
  const [[resumo]] = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM cases WHERE partner_id = ?) AS casos,
      (SELECT COUNT(*) FROM cases WHERE partner_id = ? AND status = 'ativo') AS casos_ativos,
      (SELECT COALESCE(SUM(r.valor),0) FROM repasses r JOIN cases c ON c.id = r.case_id WHERE c.partner_id = ? AND r.status = 'pendente') AS repasse_a_receber,
      (SELECT COALESCE(SUM(r.valor),0) FROM repasses r JOIN cases c ON c.id = r.case_id WHERE c.partner_id = ? AND r.status = 'pago') AS repasse_recebido
  `, [partnerId, partnerId, partnerId, partnerId]) as any;
  res.json({ ...(p || {}), resumo });
});

// ── GET /api/partner-portal/cases — casos indicados por mim ─────────────────
router.get('/cases', async (req: Request, res: Response) => {
  const [rows] = await db.query(`
    SELECT c.id, c.case_number, c.title, c.legal_area, c.status, c.production_stage,
           DATEDIFF(NOW(), c.production_started_at) AS sla_days, c.created_at,
           cl.name AS client_name,
           (SELECT COALESCE(SUM(valor),0) FROM installments i WHERE i.case_id = c.id) AS valor_processo,
           (SELECT COALESCE(SUM(valor),0) FROM repasses r WHERE r.case_id = c.id) AS repasse_parceiro
      FROM cases c LEFT JOIN clients cl ON cl.id = c.client_id
     WHERE c.partner_id = ? ORDER BY c.created_at DESC`, [(req as any).partnerId]) as any;
  res.json(rows);
});

// ── GET /api/partner-portal/cases/:id — detalhe (ficha SEM contato + movs + financeiro)
router.get('/cases/:id', async (req: Request, res: Response) => {
  const partnerId = (req as any).partnerId;
  const [[c]] = await db.query(`
    SELECT c.id, c.case_number, c.title, c.legal_area, c.phase, c.status, c.production_stage,
           c.production_started_at, c.description, cl.name AS client_name
      FROM cases c LEFT JOIN clients cl ON cl.id = c.client_id
     WHERE c.id = ? AND c.partner_id = ?`, [req.params.id, partnerId]) as any;
  if (!c) { res.status(404).json({ error: 'Caso não encontrado' }); return; }

  // Movimentações: registros manuais do caso + movimentações capturadas pelo
  // MONITORAMENTO (DataJud) do processo vinculado (por case_id ou nº do processo).
  const [movements] = await db.query(
    `SELECT description, movement_date, created_at FROM (
       SELECT description, movement_date, created_at
         FROM case_movements WHERE case_id = ?
       UNION ALL
       SELECT TRIM(CONCAT(COALESCE(pm.title, ''),
                          CASE WHEN pm.description IS NOT NULL AND pm.description <> ''
                               THEN CONCAT(' — ', LEFT(pm.description, 600)) ELSE '' END)) AS description,
              pm.movement_date, pm.created_at
         FROM process_movements pm
         JOIN legal_processes lp ON lp.id = pm.process_id
        WHERE lp.case_id = ? OR (? <> '' AND lp.process_number = ?)
     ) m
     WHERE m.description <> ''
     ORDER BY COALESCE(m.movement_date, m.created_at) DESC LIMIT 80`,
    [req.params.id, req.params.id, c.case_number || '', c.case_number || '']) as any;
  const [installments] = await db.query(
    'SELECT numero, valor, due_date, status FROM installments WHERE case_id = ? ORDER BY numero ASC',
    [req.params.id]) as any;
  const [repasses] = await db.query(
    'SELECT valor, tipo, status, data_vencimento, data_repasse, descricao FROM repasses WHERE case_id = ? ORDER BY id DESC',
    [req.params.id]) as any;

  // Ficha do cliente ao parceiro: SEM contato (telefone/e-mail).
  res.json({
    id: c.id, case_number: c.case_number, title: c.title, legal_area: c.legal_area,
    phase: c.phase, status: c.status, production_stage: c.production_stage,
    client_name: c.client_name, resumo: c.description || '',
    movements, installments, repasses,
  });
});

// ── GET /api/partner-portal/financial — repasses do parceiro (todos os casos) ─
router.get('/financial', async (req: Request, res: Response) => {
  const [repasses] = await db.query(`
    SELECT r.valor, r.tipo, r.status, r.data_vencimento, r.data_repasse, r.descricao,
           c.title AS case_title, c.case_number, cl.name AS client_name
      FROM repasses r
      JOIN cases c ON c.id = r.case_id
      LEFT JOIN clients cl ON cl.id = c.client_id
     WHERE c.partner_id = ? ORDER BY r.data_vencimento DESC`, [(req as any).partnerId]) as any;
  res.json(repasses);
});

// ── GET /api/partner-portal/entradas — taxas de entrada que o parceiro deve ─
// São os financial_records lançados pela regra da parceria (Entrada parceria…).
router.get('/entradas', async (req: Request, res: Response) => {
  const [rows] = await db.query(`
    SELECT fr.id, fr.description, fr.valor, fr.status, fr.due_date, fr.paid_at,
           cl.name AS client_name, c.case_number, c.title AS case_title
      FROM financial_records fr
      JOIN cases c  ON c.id  = fr.case_id  AND c.partner_id = ?
      LEFT JOIN clients cl ON cl.id = fr.client_id
     WHERE fr.description LIKE 'Entrada parceria%'
     ORDER BY fr.due_date ASC`, [(req as any).partnerId]) as any;
  const total_devido = rows.reduce((s: number, r: any) => s + (r.status !== 'pago' ? Number(r.valor) : 0), 0);
  const total_pago   = rows.reduce((s: number, r: any) => s + (r.status === 'pago'  ? Number(r.valor) : 0), 0);
  res.json({ rows, total_devido, total_pago });
});

// ── GET /api/partner-portal/timeline — atualizações de todos os casos ────────
router.get('/timeline', async (req: Request, res: Response) => {
  const [rows] = await db.query(`
    SELECT cm.description, cm.movement_date, cm.created_at,
           c.id AS case_id, c.case_number, c.title AS case_title, cl.name AS client_name
      FROM case_movements cm
      JOIN cases c ON c.id = cm.case_id AND c.partner_id = ?
      LEFT JOIN clients cl ON cl.id = c.client_id
     ORDER BY COALESCE(cm.movement_date, cm.created_at) DESC LIMIT 60`, [(req as any).partnerId]) as any;
  res.json(rows);
});

export default router;
