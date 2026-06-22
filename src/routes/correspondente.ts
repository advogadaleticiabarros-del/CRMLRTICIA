import { Router, Request, Response } from 'express';
import { db } from '../config/database';

const router = Router();

const ROLES = ['advogado', 'preposto'];
const STATUSES = ['agendada', 'realizada', 'faturada', 'paga', 'cancelada'];

// ── GET /api/correspondente/summary — KPIs ──────────────────────────────────
router.get('/summary', async (_req: Request, res: Response) => {
  const [[s]] = await db.query(`
    SELECT
      COALESCE(SUM(CASE WHEN status='agendada' THEN 1 ELSE 0 END),0)                          AS agendadas,
      COALESCE(SUM(CASE WHEN status='realizada' THEN 1 ELSE 0 END),0)                         AS realizadas,
      COALESCE(SUM(CASE WHEN status IN ('realizada','faturada') THEN value ELSE 0 END),0)     AS a_receber,
      COALESCE(SUM(CASE WHEN status='paga' THEN value ELSE 0 END),0)                          AS recebido,
      COALESCE(SUM(CASE WHEN status NOT IN ('cancelada','paga') THEN value ELSE 0 END),0)     AS previsto
    FROM correspondent_hearings
  `) as any;
  res.json(s);
});

// ── GET /api/correspondente — lista com filtros ─────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const status = req.query.status as string;
  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (status && STATUSES.includes(status)) { where.push('status = ?'); params.push(status); }
  const [rows] = await db.query(
    `SELECT * FROM correspondent_hearings WHERE ${where.join(' AND ')} ORDER BY hearing_datetime DESC LIMIT 300`, params
  ) as any;
  res.json(rows);
});

// ── POST /api/correspondente — criar ────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { hearing_datetime, role, process_number, comarca, vara, location, requesting_office,
          payer_name, payer_type, payer_document, value, status, due_date, notes } = req.body;
  if (!hearing_datetime) { res.status(400).json({ error: 'Data e hora da audiência são obrigatórias' }); return; }
  if (!payer_name || !String(payer_name).trim()) { res.status(400).json({ error: 'O pagador é obrigatório' }); return; }

  const [result] = await db.query(
    `INSERT INTO correspondent_hearings
       (user_id, hearing_datetime, role, process_number, comarca, vara, location, requesting_office,
        payer_name, payer_type, payer_document, value, status, due_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user!.id, hearing_datetime, ROLES.includes(role) ? role : 'advogado',
     process_number ?? null, comarca ?? null, vara ?? null, location ?? null, requesting_office ?? null,
     payer_name.trim(), payer_type === 'PF' ? 'PF' : 'PJ', payer_document ?? null,
     Number(value) || 0, STATUSES.includes(status) ? status : 'agendada', due_date || null, notes ?? null]
  ) as any;
  const [rows] = await db.query('SELECT * FROM correspondent_hearings WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── PUT /api/correspondente/:id ─────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT id FROM correspondent_hearings WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Audiência não encontrada' }); return; }
  const fields: string[] = []; const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => { if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); } };
  setIf('hearing_datetime', req.body.hearing_datetime);
  setIf('role', req.body.role, ROLES.includes(req.body.role));
  setIf('process_number', req.body.process_number);
  setIf('comarca', req.body.comarca);
  setIf('vara', req.body.vara);
  setIf('location', req.body.location);
  setIf('requesting_office', req.body.requesting_office);
  setIf('payer_name', req.body.payer_name?.trim?.());
  setIf('payer_type', req.body.payer_type, ['PJ', 'PF'].includes(req.body.payer_type));
  setIf('payer_document', req.body.payer_document);
  setIf('value', req.body.value !== undefined ? Number(req.body.value) : undefined);
  setIf('status', req.body.status, STATUSES.includes(req.body.status));
  setIf('due_date', req.body.due_date);
  setIf('notes', req.body.notes);
  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido' }); return; }
  params.push(id);
  await db.query(`UPDATE correspondent_hearings SET ${fields.join(', ')} WHERE id = ?`, params);
  const [rows] = await db.query('SELECT * FROM correspondent_hearings WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

// ── PATCH /api/correspondente/:id/status ────────────────────────────────────
router.patch('/:id/status', async (req: Request, res: Response) => {
  const { status } = req.body;
  if (!STATUSES.includes(status)) { res.status(400).json({ error: `status deve ser: ${STATUSES.join(', ')}` }); return; }
  const paidSql = status === 'paga' ? ', paid_at = COALESCE(paid_at, CURDATE())' : '';
  const [r] = await db.query(`UPDATE correspondent_hearings SET status = ?${paidSql} WHERE id = ?`, [status, req.params.id]) as any;
  if (!r.affectedRows) { res.status(404).json({ error: 'Audiência não encontrada' }); return; }
  res.json({ success: true, id: Number(req.params.id), status });
});

// ── DELETE /api/correspondente/:id ──────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  const [r] = await db.query('DELETE FROM correspondent_hearings WHERE id = ?', [req.params.id]) as any;
  if (!r.affectedRows) { res.status(404).json({ error: 'Audiência não encontrada' }); return; }
  res.json({ success: true, id: Number(req.params.id) });
});

export default router;
