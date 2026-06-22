import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { rentabilidadeClientes, rentabilidadeProcessos, centroCusto, provisionamentoResumo } from '../services/controladoriaService';

const router = Router();

const TYPES = ['ganho', 'perda'];
const LIKELIHOODS = ['provavel', 'possivel', 'remoto'];

// ── Rentabilidade ───────────────────────────────────────────────────────────
router.get('/rentabilidade/clientes', async (_req: Request, res: Response) => {
  res.json(await rentabilidadeClientes());
});
router.get('/rentabilidade/processos', async (_req: Request, res: Response) => {
  res.json(await rentabilidadeProcessos());
});

// ── Centro de custo ─────────────────────────────────────────────────────────
router.get('/centro-custo', async (_req: Request, res: Response) => {
  res.json(await centroCusto());
});

// ── Provisionamento ─────────────────────────────────────────────────────────
router.get('/provisoes/resumo', async (_req: Request, res: Response) => {
  res.json(await provisionamentoResumo());
});

router.get('/provisoes', async (req: Request, res: Response) => {
  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (req.query.case_id) { where.push('p.case_id = ?'); params.push(req.query.case_id); }
  if (req.query.type && TYPES.includes(req.query.type as string)) { where.push('p.type = ?'); params.push(req.query.type); }
  const [rows] = await db.query(
    `SELECT p.*, c.title AS case_title, cl.name AS client_name
       FROM case_provisions p
       LEFT JOIN cases c ON c.id = p.case_id
       LEFT JOIN clients cl ON cl.id = p.client_id
      WHERE ${where.join(' AND ')} ORDER BY p.value DESC LIMIT 300`, params
  ) as any;
  res.json(rows);
});

router.post('/provisoes', async (req: Request, res: Response) => {
  const { case_id, client_id, type, likelihood, value, description } = req.body;
  if (!TYPES.includes(type)) { res.status(400).json({ error: "type deve ser 'ganho' ou 'perda'" }); return; }
  if (!LIKELIHOODS.includes(likelihood)) { res.status(400).json({ error: 'likelihood inválido' }); return; }

  // Se veio case_id e não client_id, herda o cliente do caso
  let clientId = client_id ?? null;
  if (case_id && !clientId) {
    const [[c]] = await db.query('SELECT client_id FROM cases WHERE id = ?', [case_id]) as any;
    clientId = c?.client_id ?? null;
  }

  const [result] = await db.query(
    `INSERT INTO case_provisions (case_id, client_id, type, likelihood, value, description, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [case_id ?? null, clientId, type, likelihood, Number(value) || 0, description ?? null, req.user!.id]
  ) as any;
  const [rows] = await db.query('SELECT * FROM case_provisions WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

router.put('/provisoes/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT id FROM case_provisions WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Provisão não encontrada' }); return; }
  const fields: string[] = []; const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => { if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); } };
  setIf('type', req.body.type, TYPES.includes(req.body.type));
  setIf('likelihood', req.body.likelihood, LIKELIHOODS.includes(req.body.likelihood));
  setIf('value', req.body.value !== undefined ? Number(req.body.value) : undefined);
  setIf('description', req.body.description);
  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido' }); return; }
  params.push(id);
  await db.query(`UPDATE case_provisions SET ${fields.join(', ')} WHERE id = ?`, params);
  const [rows] = await db.query('SELECT * FROM case_provisions WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

router.delete('/provisoes/:id', async (req: Request, res: Response) => {
  const [r] = await db.query('DELETE FROM case_provisions WHERE id = ?', [req.params.id]) as any;
  if (!r.affectedRows) { res.status(404).json({ error: 'Provisão não encontrada' }); return; }
  res.json({ success: true, id: Number(req.params.id) });
});

export default router;
