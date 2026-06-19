import { Router, Request, Response } from 'express';
import { db } from '../config/database';

const router = Router();

// ── GET /api/lawyers ────────────────────────────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT id, name, oab_number, oab_uf, email, phone, practice_areas,
            monitoring_enabled, active, last_sync_at
     FROM lawyers ORDER BY name`
  ) as any;
  res.json(rows);
});

// ── POST /api/lawyers ───────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { name, oab_number, oab_uf, email, phone, practice_areas } = req.body;
  if (!name || !String(name).trim()) { res.status(400).json({ error: 'O nome é obrigatório' }); return; }

  const [result] = await db.query(
    `INSERT INTO lawyers (name, oab_number, oab_uf, email, phone, practice_areas)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name.trim(), oab_number ?? null, (oab_uf || '').toUpperCase() || null, email ?? null, phone ?? null,
     practice_areas ? JSON.stringify(practice_areas) : null]
  ) as any;
  const [rows] = await db.query('SELECT * FROM lawyers WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── PUT /api/lawyers/:id — editar OAB, contatos, monitoramento ──────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT id FROM lawyers WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Advogado não encontrado' }); return; }

  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };
  setIf('name', req.body.name);
  setIf('oab_number', req.body.oab_number);
  setIf('oab_uf', req.body.oab_uf ? String(req.body.oab_uf).toUpperCase() : undefined);
  setIf('email', req.body.email);
  setIf('phone', req.body.phone);
  setIf('telegram_chat_id', req.body.telegram_chat_id);
  if (req.body.practice_areas !== undefined) { fields.push('practice_areas = ?'); params.push(JSON.stringify(req.body.practice_areas)); }
  if (req.body.monitoring_enabled !== undefined) { fields.push('monitoring_enabled = ?'); params.push(req.body.monitoring_enabled ? 1 : 0); }
  if (req.body.active !== undefined) { fields.push('active = ?'); params.push(req.body.active ? 1 : 0); }

  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido' }); return; }
  params.push(id);
  await db.query(`UPDATE lawyers SET ${fields.join(', ')} WHERE id = ?`, params);
  const [rows] = await db.query('SELECT * FROM lawyers WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

export default router;
