import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { logActivity } from '../services/JourneyService';

const router = Router();

const STATUS_PT: Record<string, string> = {
  triagem: 'Triagem', atendimento_inicial: 'Atendimento inicial', reuniao: 'Consulta/Reunião',
  proposta: 'Proposta', proposta_em_analise: 'Proposta em análise', fechada: 'Fechada', perdida: 'Perdida',
};

const STATUSES = ['triagem', 'atendimento_inicial', 'reuniao', 'proposta', 'proposta_em_analise', 'fechada', 'perdida'];
const ACTIVE_STATUSES = ['triagem', 'atendimento_inicial', 'reuniao', 'proposta', 'proposta_em_analise'];
const AREAS = ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro'];

// ── GET /api/leads/board — funil agrupado por status (kanban) ───────────────
router.get('/board', async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const [rows] = await db.query(
    `SELECT id, name, email, phone, source, legal_area, status, created_at, analise_since
     FROM leads
     WHERE user_id = ? AND status IN ('triagem','atendimento_inicial','reuniao','proposta','proposta_em_analise')
     ORDER BY created_at DESC`,
    [userId]
  ) as any;

  const board: Record<string, any[]> = {};
  for (const s of ACTIVE_STATUSES) board[s] = [];
  for (const lead of rows) {
    (board[lead.status] ??= []).push(lead);
  }

  res.json(board);
});

// ── GET /api/leads — lista com filtros e paginação ──────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const search = (req.query.search as string)?.trim();
  const status = req.query.status as string;
  const area   = req.query.area as string;
  const page   = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const params: any[] = [];

  if (search) {
    where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (status && STATUSES.includes(status)) { where.push('status = ?'); params.push(status); }
  if (area && AREAS.includes(area))         { where.push('legal_area = ?'); params.push(area); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM leads ${whereSql}`, params
  ) as any;

  const [rows] = await db.query(
    `SELECT id, name, email, phone, source, legal_area, status, created_at
     FROM leads ${whereSql}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as any;

  res.json({ data: rows, total, page, limit, pages: Math.ceil(total / limit) });
});

// ── GET /api/leads/:id ──────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT l.*, c.name AS client_name, u.name AS responsavel
     FROM leads l
     LEFT JOIN clients c ON c.id = l.client_id
     LEFT JOIN users u   ON u.id = l.user_id
     WHERE l.id = ?`,
    [req.params.id]
  ) as any;

  if (!rows.length) {
    res.status(404).json({ error: 'Lead não encontrado' });
    return;
  }
  res.json(rows[0]);
});

// ── POST /api/leads ─────────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { name, email, phone, source, legal_area, status, notes, client_id } = req.body;

  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'O nome é obrigatório' });
    return;
  }

  const [result] = await db.query(
    `INSERT INTO leads (user_id, client_id, name, email, phone, source, legal_area, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user!.id,
      client_id ?? null,
      name.trim(),
      email ?? null,
      phone ?? null,
      source ?? null,
      AREAS.includes(legal_area) ? legal_area : null,
      STATUSES.includes(status) ? status : 'triagem',
      notes ?? null,
    ]
  ) as any;

  const [rows] = await db.query('SELECT * FROM leads WHERE id = ?', [result.insertId]) as any;

  await logActivity({
    leadId: result.insertId, clientId: client_id ?? null, actorId: req.user!.id, actorName: req.user!.name,
    eventType: 'lead_created', title: 'Lead entrou no funil',
    description: `Origem: ${source || '—'} · Área: ${rows[0].legal_area || '—'}`,
    newValue: STATUS_PT[rows[0].status] || rows[0].status,
  });

  res.status(201).json(rows[0]);
});

// ── PUT /api/leads/:id ──────────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const body = req.body;

  const [existing] = await db.query('SELECT id FROM leads WHERE id = ?', [id]) as any;
  if (!existing.length) {
    res.status(404).json({ error: 'Lead não encontrado' });
    return;
  }

  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };

  setIf('name', body.name?.trim?.());
  setIf('email', body.email);
  setIf('phone', body.phone);
  setIf('source', body.source);
  setIf('legal_area', body.legal_area, AREAS.includes(body.legal_area));
  setIf('status', body.status, STATUSES.includes(body.status));
  setIf('notes', body.notes);

  if (!fields.length) {
    res.status(400).json({ error: 'Nenhum campo válido para atualizar' });
    return;
  }

  params.push(id);
  await db.query(`UPDATE leads SET ${fields.join(', ')} WHERE id = ?`, params);

  const [rows] = await db.query('SELECT * FROM leads WHERE id = ?', [id]) as any;

  const COL_PT: Record<string, string> = { name: 'nome', email: 'e-mail', phone: 'telefone', source: 'origem', legal_area: 'área', status: 'status', notes: 'observações' };
  const changed = fields.map((f) => COL_PT[f.split(' ')[0]] || f.split(' ')[0]);
  await logActivity({
    leadId: Number(id), clientId: rows[0].client_id, actorId: req.user!.id, actorName: req.user!.name,
    eventType: 'lead_updated', title: 'Dados do lead atualizados',
    description: `Campos alterados: ${changed.join(', ')}`,
  });

  res.json(rows[0]);
});

// ── PATCH /api/leads/:id/status — mover no funil ────────────────────────────
router.patch('/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!STATUSES.includes(status)) {
    res.status(400).json({ error: `status deve ser um de: ${STATUSES.join(', ')}` });
    return;
  }

  const [prevRows] = await db.query('SELECT status, client_id FROM leads WHERE id = ?', [id]) as any;
  if (!prevRows.length) { res.status(404).json({ error: 'Lead não encontrado' }); return; }
  const prev = prevRows[0];

  // Marca o início da análise (regra dos 7 dias). Limpa ao sair da análise.
  const analiseSql = status === 'proposta_em_analise'
    ? ', analise_since = NOW()'
    : ', analise_since = NULL';

  await db.query(`UPDATE leads SET status = ?${analiseSql} WHERE id = ?`, [status, id]);

  await logActivity({
    leadId: Number(id), clientId: prev.client_id, actorId: req.user!.id, actorName: req.user!.name,
    eventType: 'lead_stage_changed', title: 'Etapa do funil alterada',
    oldValue: STATUS_PT[prev.status] || prev.status, newValue: STATUS_PT[status] || status,
  });

  res.json({ success: true, id: Number(id), status });
});

// ── POST /api/leads/:id/convert-client — converte lead em cliente ───────────
router.post('/:id/convert-client', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { tipo } = req.body;

  const [rows] = await db.query('SELECT * FROM leads WHERE id = ?', [id]) as any;
  if (!rows.length) {
    res.status(404).json({ error: 'Lead não encontrado' });
    return;
  }
  const lead = rows[0];

  if (lead.client_id) {
    res.status(409).json({ error: 'Lead já vinculado a um cliente', client_id: lead.client_id });
    return;
  }

  const [result] = await db.query(
    `INSERT INTO clients (name, tipo, email, phone, status, created_by, notes)
     VALUES (?, ?, ?, ?, 'ativo', ?, ?)`,
    [lead.name, tipo === 'PJ' ? 'PJ' : 'PF', lead.email, lead.phone, lead.user_id, lead.notes]
  ) as any;

  await db.query(
    "UPDATE leads SET client_id = ?, status = 'convertido' WHERE id = ?",
    [result.insertId, id]
  );

  await logActivity({
    leadId: Number(id), clientId: result.insertId, actorId: req.user!.id, actorName: req.user!.name,
    eventType: 'lead_converted_client', title: 'Lead convertido em cliente',
    description: `${lead.name} agora é cliente (${tipo === 'PJ' ? 'PJ' : 'PF'})`,
  });

  res.status(201).json({ success: true, client_id: result.insertId });
});

export default router;
