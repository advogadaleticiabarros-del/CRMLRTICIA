import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { logFinancialAudit } from '../services/FinancialAuditService';
import { logTimeline } from '../services/TimelineService';
import { syncAgreementFinanceLaunches, montarCronogramaAcordo } from '../services/agreementFinance';

const router = Router();

const STATUSES = ['Proposto', 'Aceito', 'Homologado', 'Em pagamento', 'Quitado', 'Descumprido'];
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── GET /api/acordos — lista com filtros ────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const status = req.query.status as string;
  const clientId = req.query.client_id as string;
  const caseId = req.query.case_id as string;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));
  const offset = (page - 1) * limit;

  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (status && STATUSES.includes(status)) { where.push('a.status = ?'); params.push(status); }
  if (clientId) { where.push('a.client_id = ?'); params.push(clientId); }
  if (caseId) { where.push('a.case_id = ?'); params.push(caseId); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM agreements a ${whereSql}`, params) as any;
  const [rows] = await db.query(
    `SELECT a.*, cl.name AS client_name
       FROM agreements a
       LEFT JOIN clients cl ON cl.id = a.client_id
       ${whereSql} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as any;

  res.json({ data: rows, total, page, limit, pages: Math.ceil(total / limit) });
});

// ── GET /api/acordos/stats/resumo — estatísticas ────────────────────────────
router.get('/stats/resumo', async (_req: Request, res: Response) => {
  const [byStatus] = await db.query('SELECT status, COUNT(*) AS qtd FROM agreements GROUP BY status') as any;
  const [[tot]] = await db.query(
    'SELECT COUNT(*) AS total_acordos, COALESCE(SUM(honorarium_value),0) AS honorarios_total FROM agreements'
  ) as any;
  const porStatus: Record<string, number> = {};
  for (const s of STATUSES) porStatus[s] = 0;
  for (const r of byStatus) porStatus[r.status] = Number(r.qtd);
  res.json({ total_acordos: Number(tot.total_acordos), honorarios_total: Number(tot.honorarios_total), por_status: porStatus });
});

// ── GET /api/acordos/:id ────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const [rows] = await db.query('SELECT * FROM agreements WHERE id = ?', [req.params.id]) as any;
  if (!rows.length) { res.status(404).json({ error: 'Acordo não encontrado' }); return; }
  res.json(rows[0]);
});

// ── GET /api/acordos/:id/cronograma — prévia da entrada + parcelas ─────────
router.get('/:id/cronograma', async (req: Request, res: Response) => {
  const [[a]] = await db.query('SELECT * FROM agreements WHERE id = ?', [req.params.id]) as any;
  if (!a) { res.status(404).json({ error: 'Acordo não encontrado' }); return; }
  res.json({ tranches: montarCronogramaAcordo(a) });
});

// ── POST /api/acordos — criar ───────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const {
    client_id, case_id, process_number, opposing_party,
    total_agreement_value, entrada_value, entrada_date, installments_count, first_due_date,
    honorarium_percentage, honorarium_value, sucumbencia_value, sucumbencia_due_date,
    receiving_method, notes,
  } = req.body;

  if (!client_id) { res.status(400).json({ error: 'client_id é obrigatório' }); return; }
  if (!opposing_party || !String(opposing_party).trim()) { res.status(400).json({ error: 'opposing_party é obrigatório' }); return; }
  if (!first_due_date) { res.status(400).json({ error: 'first_due_date é obrigatória' }); return; }

  const totalValue = Number(total_agreement_value) || 0;
  const honPct = Number(honorarium_percentage) || 0;
  const honValue = honorarium_value !== undefined ? Number(honorarium_value) : round2((totalValue * honPct) / 100);

  const [result] = await db.query(
    `INSERT INTO agreements
       (client_id, case_id, process_number, opposing_party, total_agreement_value, entrada_value, entrada_date,
        installments_count, first_due_date, honorarium_percentage, honorarium_value,
        sucumbencia_value, sucumbencia_due_date, receiving_method, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Proposto', ?)`,
    [client_id, case_id ?? null, process_number ?? null, opposing_party.trim(), totalValue,
     round2(entrada_value), entrada_date || null, Number(installments_count) || 1, first_due_date, honPct, honValue,
     round2(sucumbencia_value), sucumbencia_due_date || null,
     receiving_method || 'Acordo', notes ?? null]
  ) as any;

  await logFinancialAudit({
    entityType: 'Agreement', entityId: result.insertId, action: 'created',
    userId: req.user!.id, userName: req.user!.name, clientId: client_id, caseId: case_id ?? null,
    agreementId: result.insertId, newValue: totalValue, newStatus: 'Proposto',
    reason: `Acordo criado: ${opposing_party} — R$ ${totalValue}`, ipAddress: req.ip,
  });

  const { lancados } = await syncAgreementFinanceLaunches(result.insertId, req.user!.id).catch((e) => { console.error('❌ [acordo-financeiro] falha ao lançar honorários (create):', e?.message || e); return { lancados: 0 }; });

  // Centraliza no histórico do cliente: o acordo e o que foi lançado no financeiro.
  await logTimeline({
    clientId: client_id, caseId: case_id ?? null, eventType: 'acordo',
    description: `Acordo registrado com ${opposing_party.trim()} — R$ ${totalValue.toFixed(2)}` +
      (honValue > 0 ? ` · honorários contratuais R$ ${honValue.toFixed(2)}` : '') +
      (lancados > 0 ? ` (${lancados} lançamento(s) no financeiro)` : ''),
    userId: req.user!.id,
  }).catch(() => {});

  const [rows] = await db.query('SELECT * FROM agreements WHERE id = ?', [result.insertId]) as any;
  res.status(201).json({ ...rows[0], lancamentos_financeiros: lancados });
});

// ── PUT /api/acordos/:id — atualizar ────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT * FROM agreements WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Acordo não encontrado' }); return; }
  const prev = existing[0];

  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };
  setIf('client_id', req.body.client_id !== undefined ? Number(req.body.client_id) : undefined);
  setIf('case_id', req.body.case_id !== undefined ? (req.body.case_id || null) : undefined);
  setIf('opposing_party', req.body.opposing_party?.trim?.());
  setIf('process_number', req.body.process_number);
  setIf('total_agreement_value', req.body.total_agreement_value !== undefined ? Number(req.body.total_agreement_value) : undefined);
  setIf('entrada_value', req.body.entrada_value !== undefined ? round2(req.body.entrada_value) : undefined);
  setIf('entrada_date', req.body.entrada_date !== undefined ? (req.body.entrada_date || null) : undefined);
  setIf('installments_count', req.body.installments_count !== undefined ? Number(req.body.installments_count) : undefined);
  setIf('first_due_date', req.body.first_due_date);
  setIf('honorarium_percentage', req.body.honorarium_percentage !== undefined ? Number(req.body.honorarium_percentage) : undefined);
  setIf('honorarium_value', req.body.honorarium_value !== undefined ? Number(req.body.honorarium_value) : undefined);
  setIf('sucumbencia_value', req.body.sucumbencia_value !== undefined ? round2(req.body.sucumbencia_value) : undefined);
  setIf('sucumbencia_due_date', req.body.sucumbencia_due_date !== undefined ? (req.body.sucumbencia_due_date || null) : undefined);
  setIf('receiving_method', req.body.receiving_method);
  setIf('status', req.body.status, STATUSES.includes(req.body.status));
  setIf('notes', req.body.notes);

  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido para atualizar' }); return; }
  params.push(id);
  await db.query(`UPDATE agreements SET ${fields.join(', ')} WHERE id = ?`, params);

  await logFinancialAudit({
    entityType: 'Agreement', entityId: Number(id), action: 'updated',
    userId: req.user!.id, userName: req.user!.name, clientId: prev.client_id, agreementId: Number(id),
    oldStatus: prev.status, newStatus: req.body.status && STATUSES.includes(req.body.status) ? req.body.status : prev.status,
    reason: 'Acordo atualizado via API', ipAddress: req.ip,
  });

  // Re-sincroniza o financeiro: refaz só os lançamentos PENDENTES deste acordo
  // (o que já foi recebido/pago fica intacto).
  const { lancados } = await syncAgreementFinanceLaunches(Number(id), req.user!.id).catch((e) => { console.error('❌ [acordo-financeiro] falha ao lançar honorários (update):', e?.message || e); return { lancados: 0 }; });

  const [rows] = await db.query('SELECT * FROM agreements WHERE id = ?', [id]) as any;
  const atual = rows[0];
  await logTimeline({
    clientId: atual.client_id, caseId: atual.case_id ?? null, eventType: 'acordo_atualizado',
    description: `Acordo atualizado — ${atual.opposing_party} — R$ ${Number(atual.total_agreement_value).toFixed(2)}` +
      (lancados > 0 ? ` (${lancados} lançamento(s) refeito(s) no financeiro)` : ''),
    userId: req.user!.id,
  }).catch(() => {});

  res.json({ ...atual, lancamentos_financeiros: lancados });
});

// Helper de transição de status
async function transition(req: Request, res: Response, newStatus: string, action: string, label: string) {
  const { id } = req.params;
  const [existing] = await db.query('SELECT * FROM agreements WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Acordo não encontrado' }); return; }
  const prev = existing[0];

  const notes = req.body?.observacao ?? req.body?.notes;
  await db.query(
    'UPDATE agreements SET status = ?, notes = COALESCE(?, notes) WHERE id = ?',
    [newStatus, notes ?? null, id]
  );

  // Descumprido: a parte contrária não vai mais pagar — cancela o que ainda
  // estava pendente no financeiro (o que já foi recebido permanece).
  if (newStatus === 'Descumprido') {
    await db.query("UPDATE financial_records SET status = 'cancelado' WHERE agreement_id = ? AND status = 'pendente'", [id]).catch(() => {});
  }

  await logFinancialAudit({
    entityType: 'Agreement', entityId: Number(id), action,
    userId: req.user!.id, userName: req.user!.name, clientId: prev.client_id, agreementId: Number(id),
    oldStatus: prev.status, newStatus, reason: `${label}. ${notes || ''}`.trim(), ipAddress: req.ip,
  });
  await logTimeline({
    clientId: prev.client_id, caseId: prev.case_id ?? null, eventType: 'acordo_status',
    description: `${label} — ${prev.opposing_party}${notes ? `. ${notes}` : ''}`,
    userId: req.user!.id,
  }).catch(() => {});
  const [rows] = await db.query('SELECT * FROM agreements WHERE id = ?', [id]) as any;
  res.json(rows[0]);
}

// ── POST /api/acordos/:id/assinar | /encerrar | /cancelar ───────────────────
router.post('/:id/assinar',  (req, res) => transition(req, res, 'Aceito',      'signed',    'Acordo assinado'));
router.post('/:id/encerrar', (req, res) => transition(req, res, 'Quitado',     'closed',    'Acordo encerrado/quitado'));
router.post('/:id/cancelar', (req, res) => transition(req, res, 'Descumprido', 'cancelled', 'Acordo cancelado/descumprido'));

export default router;
