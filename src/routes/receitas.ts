import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { logFinancialAudit } from '../services/FinancialAuditService';

const router = Router();

const TIPOS = ['servico', 'reembolso', 'honorario'];
const STATUSES = ['aberto', 'parcial', 'recebido', 'cancelado'];

// ── GET /api/receitas — lista com filtros e paginação ───────────────────────
router.get('/', async (req: Request, res: Response) => {
  const { status, tipo } = req.query as Record<string, string>;
  const clientId = req.query.client_id as string;
  const caseId = req.query.case_id as string;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));
  const offset = (page - 1) * limit;

  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (status && STATUSES.includes(status)) { where.push('r.status = ?'); params.push(status); }
  if (tipo && TIPOS.includes(tipo)) { where.push('r.tipo = ?'); params.push(tipo); }
  if (clientId) { where.push('r.client_id = ?'); params.push(clientId); }
  if (caseId) { where.push('r.case_id = ?'); params.push(caseId); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM receitas r ${whereSql}`, params) as any;
  const [rows] = await db.query(
    `SELECT r.*, cl.name AS client_name
       FROM receitas r
       LEFT JOIN clients cl ON cl.id = r.client_id
       ${whereSql} ORDER BY r.data_vencimento ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as any;

  res.json({ data: rows, total, page, limit, pages: Math.ceil(total / limit) });
});

// ── GET /api/receitas/cliente/:clientId/totais — KPIs por cliente ───────────
router.get('/cliente/:clientId/totais', async (req: Request, res: Response) => {
  const [[t]] = await db.query(`
    SELECT
      COALESCE(SUM(CASE WHEN status IN ('aberto','parcial') THEN valor END), 0) AS total_a_receber,
      COALESCE(SUM(CASE WHEN status = 'recebido' THEN valor END), 0)            AS total_recebido,
      COALESCE(SUM(CASE WHEN status IN ('aberto','parcial')
                         AND data_vencimento < CURDATE() THEN valor END), 0)    AS total_vencido
    FROM receitas WHERE client_id = ?`, [req.params.clientId]) as any;
  res.json(t);
});

// ── GET /api/receitas/:id — receita + parcelas ──────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const [rows] = await db.query('SELECT * FROM receitas WHERE id = ?', [req.params.id]) as any;
  if (!rows.length) { res.status(404).json({ error: 'Receita não encontrada' }); return; }
  const [parcelas] = await db.query(
    'SELECT * FROM parcelas WHERE receita_id = ? ORDER BY numero ASC', [req.params.id]
  ) as any;
  res.json({ ...rows[0], parcelas });
});

// ── POST /api/receitas — criar ──────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { client_id, case_id, descricao, tipo, valor, data_vencimento } = req.body;
  if (!client_id) { res.status(400).json({ error: 'client_id é obrigatório' }); return; }
  if (!descricao || !String(descricao).trim()) { res.status(400).json({ error: 'A descrição é obrigatória' }); return; }
  if (!data_vencimento) { res.status(400).json({ error: 'data_vencimento é obrigatória' }); return; }
  const valorNum = Number(valor) || 0;

  const [result] = await db.query(
    `INSERT INTO receitas
       (client_id, case_id, descricao, tipo, valor, status, data_vencimento, total_recebido, saldo_pendente, criado_por)
     VALUES (?, ?, ?, ?, ?, 'aberto', ?, 0, ?, ?)`,
    [client_id, case_id ?? null, descricao.trim(), TIPOS.includes(tipo) ? tipo : 'servico',
     valorNum, data_vencimento, valorNum, req.user!.id]
  ) as any;

  await logFinancialAudit({
    entityType: 'Receita', entityId: result.insertId, action: 'created',
    userId: req.user!.id, userName: req.user!.name, clientId: client_id, caseId: case_id ?? null,
    receitaId: result.insertId, newValue: valorNum, newStatus: 'aberto',
    reason: 'Receita criada via API', ipAddress: req.ip,
  });

  const [rows] = await db.query('SELECT * FROM receitas WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── PUT /api/receitas/:id — atualizar ───────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT * FROM receitas WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Receita não encontrada' }); return; }
  const prev = existing[0];

  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };
  setIf('descricao', req.body.descricao?.trim?.());
  setIf('valor', req.body.valor !== undefined ? Number(req.body.valor) : undefined);
  setIf('data_vencimento', req.body.data_vencimento);
  setIf('tipo', req.body.tipo, TIPOS.includes(req.body.tipo));

  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido para atualizar' }); return; }
  params.push(id);
  await db.query(`UPDATE receitas SET ${fields.join(', ')} WHERE id = ?`, params);

  await logFinancialAudit({
    entityType: 'Receita', entityId: Number(id), action: 'updated',
    userId: req.user!.id, userName: req.user!.name, clientId: prev.client_id, receitaId: Number(id),
    oldValue: prev.valor, newValue: req.body.valor !== undefined ? Number(req.body.valor) : prev.valor,
    reason: 'Receita atualizada via API', ipAddress: req.ip,
  });

  const [rows] = await db.query('SELECT * FROM receitas WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

// ── POST /api/receitas/:id/cancelar ─────────────────────────────────────────
router.post('/:id/cancelar', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT * FROM receitas WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Receita não encontrada' }); return; }
  const prev = existing[0];
  if (prev.status === 'cancelado') { res.json(prev); return; }

  await db.query("UPDATE receitas SET status = 'cancelado' WHERE id = ?", [id]);
  await logFinancialAudit({
    entityType: 'Receita', entityId: Number(id), action: 'cancelled',
    userId: req.user!.id, userName: req.user!.name, clientId: prev.client_id, receitaId: Number(id),
    oldStatus: prev.status, newStatus: 'cancelado',
    reason: req.body?.reason || 'Receita cancelada via API', ipAddress: req.ip,
  });

  const [rows] = await db.query('SELECT * FROM receitas WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

export default router;
