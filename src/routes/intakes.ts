import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { logActivity } from '../services/JourneyService';

const router = Router();

const AREAS = ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro'];
const SOURCES = ['telefone', 'whatsapp', 'site', 'indicacao', 'instagram', 'google', 'presencial', 'outro'];
const URGENCIES = ['baixa', 'media', 'alta'];
const POTENTIALS = ['alto', 'medio', 'baixo'];
const STATUSES = ['novo', 'em_triagem', 'qualificado', 'convertido', 'descartado'];

// ── GET /api/intakes — lista com filtros e paginação ────────────────────────
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
    where.push('(contact_name LIKE ? OR email LIKE ? OR phone LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (status && STATUSES.includes(status)) { where.push('status = ?'); params.push(status); }
  if (area && AREAS.includes(area))         { where.push('legal_area = ?'); params.push(area); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM intakes ${whereSql}`, params
  ) as any;

  const [rows] = await db.query(
    `SELECT id, contact_name, email, phone, legal_area, source, urgency, potential, status, intake_date
     FROM intakes ${whereSql}
     ORDER BY intake_date DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as any;

  res.json({ data: rows, total, page, limit, pages: Math.ceil(total / limit) });
});

// ── GET /api/intakes/:id ────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT i.*, c.name AS client_name, l.name AS lead_name, u.name AS responsavel
     FROM intakes i
     LEFT JOIN clients c ON c.id = i.client_id
     LEFT JOIN leads l   ON l.id = i.lead_id
     LEFT JOIN users u   ON u.id = i.user_id
     WHERE i.id = ?`,
    [req.params.id]
  ) as any;

  if (!rows.length) {
    res.status(404).json({ error: 'Atendimento não encontrado' });
    return;
  }
  res.json(rows[0]);
});

// ── POST /api/intakes — registrar atendimento ───────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { contact_name, email, phone, legal_area, source, report, urgency, potential, status, notes, client_id } = req.body;

  if (!contact_name || !String(contact_name).trim()) {
    res.status(400).json({ error: 'O nome do contato é obrigatório' });
    return;
  }

  const [result] = await db.query(
    `INSERT INTO intakes
       (user_id, client_id, contact_name, email, phone, legal_area, source, report, urgency, potential, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user!.id,
      client_id ?? null,
      contact_name.trim(),
      email ?? null,
      phone ?? null,
      AREAS.includes(legal_area) ? legal_area : 'outro',
      SOURCES.includes(source) ? source : 'outro',
      report ?? null,
      URGENCIES.includes(urgency) ? urgency : 'media',
      POTENTIALS.includes(potential) ? potential : null,
      STATUSES.includes(status) ? status : 'novo',
      notes ?? null,
    ]
  ) as any;

  const [rows] = await db.query('SELECT * FROM intakes WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── PUT /api/intakes/:id — atualizar (inclui triagem: potential, status) ────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const body = req.body;

  const [existing] = await db.query('SELECT id FROM intakes WHERE id = ?', [id]) as any;
  if (!existing.length) {
    res.status(404).json({ error: 'Atendimento não encontrado' });
    return;
  }

  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };

  setIf('contact_name', body.contact_name?.trim?.());
  setIf('email', body.email);
  setIf('phone', body.phone);
  setIf('legal_area', body.legal_area, AREAS.includes(body.legal_area));
  setIf('source', body.source, SOURCES.includes(body.source));
  setIf('report', body.report);
  setIf('urgency', body.urgency, URGENCIES.includes(body.urgency));
  setIf('potential', body.potential, POTENTIALS.includes(body.potential));
  setIf('status', body.status, STATUSES.includes(body.status));
  setIf('notes', body.notes);

  if (!fields.length) {
    res.status(400).json({ error: 'Nenhum campo válido para atualizar' });
    return;
  }

  params.push(id);
  await db.query(`UPDATE intakes SET ${fields.join(', ')} WHERE id = ?`, params);

  const [rows] = await db.query('SELECT * FROM intakes WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

// ── POST /api/intakes/:id/convert-lead — gera um lead a partir do atendimento ─
router.post('/:id/convert-lead', async (req: Request, res: Response) => {
  const { id } = req.params;

  const [rows] = await db.query('SELECT * FROM intakes WHERE id = ?', [id]) as any;
  if (!rows.length) {
    res.status(404).json({ error: 'Atendimento não encontrado' });
    return;
  }
  const intake = rows[0];

  if (intake.lead_id) {
    res.status(409).json({ error: 'Atendimento já convertido em lead', lead_id: intake.lead_id });
    return;
  }

  const [result] = await db.query(
    `INSERT INTO leads (user_id, client_id, name, email, phone, source, legal_area, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'triagem', ?)`,
    [intake.user_id, intake.client_id, intake.contact_name, intake.email, intake.phone,
     intake.source, intake.legal_area, intake.report]
  ) as any;

  await db.query("UPDATE intakes SET lead_id = ?, status = 'convertido' WHERE id = ?", [result.insertId, id]);

  await logActivity({
    leadId: result.insertId, clientId: intake.client_id, actorId: req.user!.id, actorName: req.user!.name,
    eventType: 'lead_created', title: 'Lead entrou no funil',
    description: `Originado do atendimento de ${intake.contact_name} · Origem: ${intake.source} · Área: ${intake.legal_area}`,
    newValue: 'Triagem',
  });

  res.status(201).json({ success: true, lead_id: result.insertId });
});

// ── POST /api/intakes/:id/convert-client — gera um cliente a partir do atendimento ─
router.post('/:id/convert-client', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { tipo } = req.body;

  const [rows] = await db.query('SELECT * FROM intakes WHERE id = ?', [id]) as any;
  if (!rows.length) {
    res.status(404).json({ error: 'Atendimento não encontrado' });
    return;
  }
  const intake = rows[0];

  if (intake.client_id) {
    res.status(409).json({ error: 'Atendimento já vinculado a um cliente', client_id: intake.client_id });
    return;
  }

  const [result] = await db.query(
    `INSERT INTO clients (name, tipo, email, phone, status, created_by, notes)
     VALUES (?, ?, ?, ?, 'ativo', ?, ?)`,
    [intake.contact_name, tipo === 'PJ' ? 'PJ' : 'PF', intake.email, intake.phone, intake.user_id, intake.report]
  ) as any;

  await db.query("UPDATE intakes SET client_id = ?, status = 'convertido' WHERE id = ?", [result.insertId, id]);

  await logActivity({
    clientId: result.insertId, actorId: req.user!.id, actorName: req.user!.name,
    eventType: 'client_created', title: 'Cliente cadastrado',
    description: `${intake.contact_name} cadastrado(a) diretamente do atendimento (${tipo === 'PJ' ? 'PJ' : 'PF'})`,
  });

  res.status(201).json({ success: true, client_id: result.insertId });
});

export default router;
