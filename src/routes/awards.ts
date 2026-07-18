import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { logTimeline } from '../services/TimelineService';

const router = Router();

const KINDS = ['rpv', 'precatorio', 'alvara', 'acordo', 'outro'];
export const KIND_PT: Record<string, string> = {
  rpv: 'RPV', precatorio: 'Precatório', alvara: 'Alvará judicial', acordo: 'Acordo', outro: 'Outro',
};

// ── GET /api/awards — lista (aguardando primeiro) ───────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const status = req.query.status ? String(req.query.status) : null;
  const where = status ? 'WHERE a.status = ?' : '';
  const [rows] = await db.query(
    `SELECT a.*, cl.name AS client_name, c.title AS case_title, c.case_number
       FROM case_awards a
       LEFT JOIN clients cl ON cl.id = a.client_id
       LEFT JOIN cases c ON c.id = a.case_id
      ORDER BY (a.status='aguardando') DESC, COALESCE(a.previsao_pagamento, a.data_expedicao) ASC
      LIMIT 300`.replace('ORDER BY', `${where} ORDER BY`),
    status ? [status] : []
  ) as any;
  res.json(rows);
});

// ── POST /api/awards — registra RPV/precatório/alvará/acordo ────────────────
router.post('/', async (req: Request, res: Response) => {
  const b = req.body || {};
  const kind = KINDS.includes(b.kind) ? b.kind : 'rpv';
  const valorEscritorio = Number(b.valor_escritorio) || 0;
  if (valorEscritorio <= 0) { res.status(400).json({ error: 'Informe o valor do escritório (honorários a receber)' }); return; }

  // Herda o cliente do caso quando só o caso foi informado.
  let clientId = b.client_id ? Number(b.client_id) : null;
  if (b.case_id && !clientId) {
    const [[c]] = await db.query('SELECT client_id FROM cases WHERE id = ?', [b.case_id]) as any;
    clientId = c?.client_id ?? null;
  }

  const [r] = await db.query(
    `INSERT INTO case_awards (case_id, client_id, kind, descricao, valor_bruto, valor_escritorio,
                              data_expedicao, previsao_pagamento, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.case_id || null, clientId, kind, (b.descricao || '').trim() || null,
     Number(b.valor_bruto) || 0, valorEscritorio,
     b.data_expedicao || null, b.previsao_pagamento || null, b.notes || null, req.user!.id]
  ) as any;

  if (clientId) {
    logTimeline({
      clientId, caseId: b.case_id ? Number(b.case_id) : null, eventType: 'exito',
      description: `${KIND_PT[kind]} registrado — R$ ${valorEscritorio.toFixed(2)} do escritório (bruto R$ ${(Number(b.valor_bruto) || 0).toFixed(2)})${b.previsao_pagamento ? ` · previsão ${b.previsao_pagamento}` : ''}.`,
      userId: req.user!.id,
    }).catch(() => {});
  }

  const [[row]] = await db.query('SELECT * FROM case_awards WHERE id = ?', [r.insertId]) as any;
  res.status(201).json(row);
});

// ── PUT /api/awards/:id — edita (valores podem mudar até o pagamento) ───────
router.put('/:id', async (req: Request, res: Response) => {
  const [[prev]] = await db.query('SELECT * FROM case_awards WHERE id = ?', [req.params.id]) as any;
  if (!prev) { res.status(404).json({ error: 'Registro não encontrado' }); return; }
  const b = req.body || {};
  const fields: string[] = []; const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => { if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); } };
  setIf('kind', b.kind, KINDS.includes(b.kind));
  setIf('descricao', b.descricao !== undefined ? (String(b.descricao).trim() || null) : undefined);
  setIf('valor_bruto', b.valor_bruto !== undefined ? Number(b.valor_bruto) || 0 : undefined);
  setIf('valor_escritorio', b.valor_escritorio !== undefined ? Number(b.valor_escritorio) || 0 : undefined);
  setIf('data_expedicao', b.data_expedicao !== undefined ? (b.data_expedicao || null) : undefined);
  setIf('previsao_pagamento', b.previsao_pagamento !== undefined ? (b.previsao_pagamento || null) : undefined);
  setIf('notes', b.notes !== undefined ? (b.notes || null) : undefined);
  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido' }); return; }
  params.push(req.params.id);
  await db.query(`UPDATE case_awards SET ${fields.join(', ')} WHERE id = ?`, params);
  const [[row]] = await db.query('SELECT * FROM case_awards WHERE id = ?', [req.params.id]) as any;
  res.json(row);
});

// ── PATCH /api/awards/:id/receber — o dinheiro caiu ─────────────────────────
router.patch('/:id/receber', async (req: Request, res: Response) => {
  const [[prev]] = await db.query('SELECT * FROM case_awards WHERE id = ?', [req.params.id]) as any;
  if (!prev) { res.status(404).json({ error: 'Registro não encontrado' }); return; }
  if (prev.status === 'recebido') { res.json({ success: true, ja_recebido: true }); return; }
  const dataRec = req.body?.data_recebimento || new Date().toISOString().split('T')[0];
  await db.query(
    "UPDATE case_awards SET status = 'recebido', data_recebimento = ? WHERE id = ?",
    [dataRec, req.params.id]
  );
  if (prev.client_id) {
    logTimeline({
      clientId: prev.client_id, caseId: prev.case_id, eventType: 'exito_recebido',
      description: `${KIND_PT[prev.kind] || prev.kind} recebido — R$ ${Number(prev.valor_escritorio).toFixed(2)}.`,
      userId: req.user!.id,
    }).catch(() => {});
  }
  res.json({ success: true });
});

// ── POST /api/awards/:id/cancelar ───────────────────────────────────────────
router.post('/:id/cancelar', async (req: Request, res: Response) => {
  const [r] = await db.query("UPDATE case_awards SET status = 'cancelado' WHERE id = ? AND status <> 'recebido'", [req.params.id]) as any;
  if (!r.affectedRows) { res.status(400).json({ error: 'Registro não encontrado ou já recebido' }); return; }
  res.json({ success: true });
});

export default router;
