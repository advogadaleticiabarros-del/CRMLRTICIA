import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { logFinancialAudit } from '../services/FinancialAuditService';

const router = Router();

const TIPOS = ['indicacao', 'audiencia', 'correspondente', 'diligencia'];
const STATUSES = ['pendente', 'processando', 'repassado', 'cancelado'];

// ── GET /api/repasses — lista com filtros ───────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const status = req.query.status as string;
  const caseId = req.query.case_id as string;
  const parceiro = req.query.parceiro as string;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));
  const offset = (page - 1) * limit;

  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (status && STATUSES.includes(status)) { where.push('rp.status = ?'); params.push(status); }
  if (caseId) { where.push('rp.case_id = ?'); params.push(caseId); }
  if (parceiro) { where.push('rp.parceiro LIKE ?'); params.push(`%${parceiro}%`); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM repasses rp ${whereSql}`, params) as any;
  const [rows] = await db.query(
    `SELECT rp.*, c.title AS case_title
       FROM repasses rp
       LEFT JOIN cases c ON c.id = rp.case_id
       ${whereSql} ORDER BY rp.data_vencimento ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as any;

  res.json({ data: rows, total, page, limit, pages: Math.ceil(total / limit) });
});

// ── GET /api/repasses/:id ───────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const [rows] = await db.query('SELECT * FROM repasses WHERE id = ?', [req.params.id]) as any;
  if (!rows.length) { res.status(404).json({ error: 'Repasse não encontrado' }); return; }
  res.json(rows[0]);
});

// ── POST /api/repasses — criar ──────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { case_id, parceiro, tipo, valor, percentual, descricao, data_vencimento } = req.body;
  if (!case_id) { res.status(400).json({ error: 'case_id é obrigatório' }); return; }
  if (!parceiro || !String(parceiro).trim()) { res.status(400).json({ error: 'parceiro é obrigatório' }); return; }
  if (!descricao || !String(descricao).trim()) { res.status(400).json({ error: 'descricao é obrigatória' }); return; }
  if (!data_vencimento) { res.status(400).json({ error: 'data_vencimento é obrigatória' }); return; }

  const valorNum = Number(valor) || 0;
  const [result] = await db.query(
    `INSERT INTO repasses
       (case_id, parceiro, tipo, valor, percentual, descricao, status, data_vencimento)
     VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?)`,
    [case_id, parceiro.trim(), TIPOS.includes(tipo) ? tipo : 'indicacao', valorNum,
     percentual !== undefined ? Number(percentual) : null, descricao.trim(), data_vencimento]
  ) as any;

  await logFinancialAudit({
    entityType: 'Repasse', entityId: result.insertId, action: 'created',
    userId: req.user!.id, userName: req.user!.name, caseId: case_id, repasseId: result.insertId,
    newValue: valorNum, newStatus: 'pendente', reason: `Repasse a ${parceiro}`, ipAddress: req.ip,
  });

  const [rows] = await db.query('SELECT * FROM repasses WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── PUT /api/repasses/:id ───────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT * FROM repasses WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Repasse não encontrado' }); return; }
  const prev = existing[0];

  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };
  setIf('parceiro', req.body.parceiro?.trim?.());
  setIf('tipo', req.body.tipo, TIPOS.includes(req.body.tipo));
  setIf('valor', req.body.valor !== undefined ? Number(req.body.valor) : undefined);
  setIf('percentual', req.body.percentual !== undefined ? Number(req.body.percentual) : undefined);
  setIf('descricao', req.body.descricao?.trim?.());
  setIf('status', req.body.status, STATUSES.includes(req.body.status));
  setIf('data_vencimento', req.body.data_vencimento);

  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido para atualizar' }); return; }
  params.push(id);
  await db.query(`UPDATE repasses SET ${fields.join(', ')} WHERE id = ?`, params);

  await logFinancialAudit({
    entityType: 'Repasse', entityId: Number(id), action: 'updated',
    userId: req.user!.id, userName: req.user!.name, caseId: prev.case_id, repasseId: Number(id),
    oldValue: prev.valor, reason: 'Repasse atualizado via API', ipAddress: req.ip,
  });

  const [rows] = await db.query('SELECT * FROM repasses WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

// ── POST /api/repasses/:id/repassar — marca como repassado ──────────────────
router.post('/:id/repassar', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT * FROM repasses WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Repasse não encontrado' }); return; }
  const prev = existing[0];

  await db.query("UPDATE repasses SET status = 'repassado', data_repasse = NOW() WHERE id = ?", [id]);
  await logFinancialAudit({
    entityType: 'Repasse', entityId: Number(id), action: 'paid',
    userId: req.user!.id, userName: req.user!.name, caseId: prev.case_id, repasseId: Number(id),
    oldStatus: prev.status, newStatus: 'repassado', reason: 'Repasse efetuado', ipAddress: req.ip,
  });
  const [rows] = await db.query('SELECT * FROM repasses WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

// ── POST /api/repasses/:id/cancelar ─────────────────────────────────────────
router.post('/:id/cancelar', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT * FROM repasses WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Repasse não encontrado' }); return; }
  const prev = existing[0];

  await db.query("UPDATE repasses SET status = 'cancelado' WHERE id = ?", [id]);
  await logFinancialAudit({
    entityType: 'Repasse', entityId: Number(id), action: 'cancelled',
    userId: req.user!.id, userName: req.user!.name, caseId: prev.case_id, repasseId: Number(id),
    oldStatus: prev.status, newStatus: 'cancelado', reason: req.body?.reason || 'Repasse cancelado', ipAddress: req.ip,
  });
  const [rows] = await db.query('SELECT * FROM repasses WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

// ── DELETE /api/repasses/:id ────────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT id FROM repasses WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Repasse não encontrado' }); return; }
  await db.query('DELETE FROM repasses WHERE id = ?', [id]);
  res.json({ success: true, id: Number(id) });
});

export default router;
