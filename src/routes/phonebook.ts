import { Router, Request, Response } from 'express';
import { db } from '../config/database';

const router = Router();
const CATEGORIES = ['forum', 'parceiro', 'cliente', 'outro'];

// ── GET /api/phonebook — lista/busca a agenda telefônica ────────────────────
router.get('/', async (req: Request, res: Response) => {
  const q = String(req.query.q || '').trim();
  const category = String(req.query.category || '').trim();
  const where: string[] = ['1=1']; const params: any[] = [];
  if (q) { where.push('(name LIKE ? OR phone LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (category && CATEGORIES.includes(category)) { where.push('category = ?'); params.push(category); }
  const [rows] = await db.query(
    `SELECT * FROM phonebook_contacts WHERE ${where.join(' AND ')} ORDER BY name ASC LIMIT 500`, params
  ) as any;
  res.json(rows);
});

// ── POST /api/phonebook — cadastra um contato ────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const phone = String(b.phone || '').replace(/\D/g, '');
  if (!name) { res.status(400).json({ error: 'O nome é obrigatório' }); return; }
  if (!phone) { res.status(400).json({ error: 'O telefone é obrigatório' }); return; }
  const category = CATEGORIES.includes(b.category) ? b.category : 'outro';
  try {
    const [r] = await db.query(
      'INSERT INTO phonebook_contacts (name, phone, category, notes, created_by) VALUES (?, ?, ?, ?, ?)',
      [name, phone, category, b.notes ?? null, req.user!.id]
    ) as any;
    const [rows] = await db.query('SELECT * FROM phonebook_contacts WHERE id = ?', [r.insertId]) as any;
    res.status(201).json(rows[0]);
  } catch (e: any) {
    if (e.code === 'ER_DUP_ENTRY') { res.status(409).json({ error: 'Já existe um contato com esse telefone na agenda' }); return; }
    throw e;
  }
});

// ── PUT /api/phonebook/:id ────────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const b = req.body || {};
  const fields: string[] = []; const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => { if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); } };
  setIf('name', b.name?.trim?.());
  setIf('phone', b.phone !== undefined ? String(b.phone).replace(/\D/g, '') : undefined);
  setIf('category', b.category, CATEGORIES.includes(b.category));
  setIf('notes', b.notes);
  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido' }); return; }
  params.push(req.params.id);
  await db.query(`UPDATE phonebook_contacts SET ${fields.join(', ')} WHERE id = ?`, params);
  const [rows] = await db.query('SELECT * FROM phonebook_contacts WHERE id = ?', [req.params.id]) as any;
  if (!rows.length) { res.status(404).json({ error: 'Contato não encontrado' }); return; }
  res.json(rows[0]);
});

// ── DELETE /api/phonebook/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  const [r] = await db.query('DELETE FROM phonebook_contacts WHERE id = ?', [req.params.id]) as any;
  if (!r.affectedRows) { res.status(404).json({ error: 'Contato não encontrado' }); return; }
  res.json({ success: true });
});

export default router;
