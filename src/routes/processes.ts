import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { TRIBUNAIS, suggestCourtAlias } from '../services/datajud';
import { syncProcess, discoverProcessesByOAB, runDiscoveryJob, ingestDjenForLawyer } from '../services/monitoringService';
import { normalizeDjenItems } from '../services/djen';

const router = Router();

// ── GET /api/processes/tribunais — aliases disponíveis + sugestão ───────────
router.get('/tribunais', (req: Request, res: Response) => {
  const suggested = req.query.area
    ? suggestCourtAlias(req.query.area as string, (req.query.uf as string) || 'ES')
    : null;
  res.json({ tribunais: TRIBUNAIS, suggested });
});

// ── GET /api/processes — lista com filtros ──────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const { client_id, lawyer_id, status, area, stale } = req.query;
  const where: string[] = [];
  const params: any[] = [];
  if (client_id) { where.push('lp.client_id = ?'); params.push(client_id); }
  if (lawyer_id) { where.push('lp.lawyer_id = ?'); params.push(lawyer_id); }
  if (status)    { where.push('lp.status = ?'); params.push(status); }
  if (area)      { where.push('lp.judicial_area = ?'); params.push(area); }
  if (stale === '30') where.push('(lp.last_movement_at IS NULL OR lp.last_movement_at < NOW() - INTERVAL 30 DAY)');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await db.query(
    `SELECT lp.id, lp.process_number, lp.court, lp.court_alias, lp.judicial_area, lp.status,
            lp.last_movement_at, lp.last_sync_at, lp.monitoring_enabled, lp.source,
            c.name AS client_name, l.name AS lawyer_name,
            (SELECT pm.title FROM process_movements pm WHERE pm.process_id = lp.id ORDER BY pm.movement_date DESC, pm.id DESC LIMIT 1) AS last_movement_title,
            (SELECT pm.description FROM process_movements pm WHERE pm.process_id = lp.id ORDER BY pm.movement_date DESC, pm.id DESC LIMIT 1) AS last_movement_text
     FROM legal_processes lp
     LEFT JOIN clients c ON c.id = lp.client_id
     LEFT JOIN lawyers l ON l.id = lp.lawyer_id
     ${whereSql} ORDER BY lp.last_movement_at DESC, lp.created_at DESC`,
    params
  ) as any;
  res.json(rows);
});

// ── GET /api/processes/:id — detalhe + movimentações ────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT lp.*, c.name AS client_name, l.name AS lawyer_name
     FROM legal_processes lp
     LEFT JOIN clients c ON c.id = lp.client_id
     LEFT JOIN lawyers l ON l.id = lp.lawyer_id
     WHERE lp.id = ?`, [req.params.id]
  ) as any;
  if (!rows.length) { res.status(404).json({ error: 'Processo não encontrado' }); return; }

  const [movs] = await db.query(
    'SELECT movement_date, title, description, source FROM process_movements WHERE process_id = ? ORDER BY COALESCE(movement_date, created_at) DESC LIMIT 100',
    [req.params.id]
  ) as any;
  res.json({ ...rows[0], movements: movs });
});

// ── POST /api/processes — cadastrar processo monitorado ─────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { client_id, lawyer_id, process_number, court_alias, judicial_area, source, distribution_date, confidential } = req.body;
  if (!process_number || !String(process_number).trim()) {
    res.status(400).json({ error: 'O número do processo é obrigatório' }); return;
  }
  const alias = court_alias && TRIBUNAIS[court_alias] ? court_alias : suggestCourtAlias(judicial_area, 'ES');
  const court = alias && TRIBUNAIS[alias] ? TRIBUNAIS[alias].nome : null;

  const [result] = await db.query(
    `INSERT INTO legal_processes
       (client_id, lawyer_id, process_number, court, court_alias, judicial_area, status, source, confidential, distribution_date)
     VALUES (?, ?, ?, ?, ?, ?, 'ativo', ?, ?, ?)`,
    [client_id ?? null, lawyer_id ?? null, process_number.trim(), court, alias, judicial_area ?? null,
     source || 'manual', confidential ? 1 : 0, distribution_date || null]
  ) as any;
  const [rows] = await db.query('SELECT * FROM legal_processes WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── PUT /api/processes/:id ──────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT id FROM legal_processes WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Processo não encontrado' }); return; }
  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };
  setIf('judicial_area', req.body.judicial_area);
  setIf('status', req.body.status, ['ativo','arquivado','suspenso','baixado'].includes(req.body.status));
  setIf('court_alias', req.body.court_alias, !req.body.court_alias || !!TRIBUNAIS[req.body.court_alias]);
  if (req.body.monitoring_enabled !== undefined) { fields.push('monitoring_enabled = ?'); params.push(req.body.monitoring_enabled ? 1 : 0); }
  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido' }); return; }
  params.push(id);
  await db.query(`UPDATE legal_processes SET ${fields.join(', ')} WHERE id = ?`, params);
  const [rows] = await db.query('SELECT * FROM legal_processes WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

// ── POST /api/processes/:id/sync — sincronizar agora (consulta o provider) ──
router.post('/:id/sync', async (req: Request, res: Response) => {
  const result = await syncProcess(Number(req.params.id));
  res.json(result);
});

// ── POST /api/processes/descobrir-oab — descoberta automática por OAB ────────
// body: { lawyer_id?: number, scope?: 'national' | 'state' }
// Sem lawyer_id → roda para todos os advogados ativos.
router.post('/descobrir-oab', async (req: Request, res: Response) => {
  const scope = req.body?.scope === 'state' ? 'state' : 'national';
  if (req.body?.lawyer_id) {
    const result = await discoverProcessesByOAB(Number(req.body.lawyer_id), scope);
    res.json(result);
    return;
  }
  const result = await runDiscoveryJob();
  res.json(result);
});

// ── POST /api/processes/ingest-djen — ingere publicações DJEN buscadas no navegador ─
// O DJEN bloqueia o IP do servidor (CloudFront 403); o navegador da advogada (IP BR)
// faz a busca e envia aqui. body: { lawyer_id, publications: [...] }
router.post('/ingest-djen', async (req: Request, res: Response) => {
  const lawyerId = Number(req.body?.lawyer_id);
  if (!lawyerId) { res.status(400).json({ error: 'lawyer_id é obrigatório' }); return; }
  const items = Array.isArray(req.body?.publications) ? req.body.publications : [];
  const pubs = normalizeDjenItems(items);
  const result = await ingestDjenForLawyer(lawyerId, pubs, undefined, (req as any).user?.id ?? null);
  res.json({ ...result, publicacoes: pubs.length });
});

// ── POST /api/processes/:id/movements — movimentação manual ─────────────────
router.post('/:id/movements', async (req: Request, res: Response) => {
  const { title, description, movement_date } = req.body;
  if (!description) { res.status(400).json({ error: 'A descrição é obrigatória' }); return; }
  const crypto = await import('crypto');
  const [proc] = await db.query('SELECT process_number FROM legal_processes WHERE id = ?', [req.params.id]) as any;
  if (!proc.length) { res.status(404).json({ error: 'Processo não encontrado' }); return; }
  const hash = crypto.createHash('sha256').update(`${proc[0].process_number}|${movement_date || ''}|${description}`).digest('hex');
  try {
    const md = movement_date ? new Date(movement_date) : null;
    await db.query(
      `INSERT INTO process_movements (process_id, movement_date, title, description, source, unique_hash)
       VALUES (?, ?, ?, ?, 'manual', ?)`,
      [req.params.id, md && !isNaN(md.getTime()) ? md : null, title ?? null, description, hash]
    );
  } catch (e: any) {
    if (e.code === 'ER_DUP_ENTRY') { res.status(409).json({ error: 'Movimentação já registrada' }); return; }
    throw e;
  }
  res.status(201).json({ success: true });
});

export default router;
