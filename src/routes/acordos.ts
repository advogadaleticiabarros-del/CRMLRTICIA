import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { logFinancialAudit } from '../services/FinancialAuditService';
import { logTimeline } from '../services/TimelineService';
import { syncAgreementFinanceLaunches, syncAgreementClientPayouts, montarCronogramaAcordo, cronogramaAcordoTexto } from '../services/agreementFinance';
import { stripDataUrlPrefix } from '../utils/dataUrl';

const router = Router();

const STATUSES = ['Proposto', 'Aceito', 'Homologado', 'Em pagamento', 'Quitado', 'Descumprido'];
const PAYMENT_FLOWS = ['direto_cliente', 'via_escritorio'];
// (Number(n) || 0) evita NaN quando entrada_value/sucumbencia_value vem
// undefined — Math.round(undefined * 100) = NaN, e o mysql2 manda NaN sem
// aspas pro SQL, virando "Unknown column 'NaN'" (achado testando a API
// direto, sem passar por esses campos no formulário).
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

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

// ── GET /api/acordos/:id/repasses — repasses ao cliente (quando via_escritorio)
router.get('/:id/repasses', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    'SELECT * FROM agreement_client_payouts WHERE agreement_id = ? ORDER BY data_prevista ASC',
    [req.params.id]
  ) as any;
  res.json(rows);
});

// ── PATCH /api/acordos/repasses/:payoutId/marcar-repassado ──────────────────
router.patch('/repasses/:payoutId/marcar-repassado', async (req: Request, res: Response) => {
  const [result] = await db.query(
    "UPDATE agreement_client_payouts SET status = 'repassado', data_repasse = NOW() WHERE id = ?",
    [req.params.payoutId]
  ) as any;
  if (!result.affectedRows) { res.status(404).json({ error: 'Repasse não encontrado' }); return; }
  const [[row]] = await db.query('SELECT * FROM agreement_client_payouts WHERE id = ?', [req.params.payoutId]) as any;
  res.json(row);
});

// ── POST /api/acordos/:id/gerar-termo — Termo de Acordo Extrajudicial ───────
// Reusa o mecanismo de document_templates (mesmo de Procuração/Contrato de
// Honorários) com o modelo inserido na migration 076.
router.post('/:id/gerar-termo', async (req: Request, res: Response) => {
  const [[a]] = await db.query('SELECT * FROM agreements WHERE id = ?', [req.params.id]) as any;
  if (!a) { res.status(404).json({ error: 'Acordo não encontrado' }); return; }
  const [[client]] = await db.query('SELECT * FROM clients WHERE id = ?', [a.client_id]) as any;
  if (!client) { res.status(404).json({ error: 'Cliente não encontrado' }); return; }
  const [[tpl]] = await db.query("SELECT * FROM document_templates WHERE name = 'Termo de Acordo Extrajudicial'") as any;
  if (!tpl) { res.status(500).json({ error: 'Modelo do termo não encontrado — confira se a migration 076 foi aplicada' }); return; }
  const [[lawyer]] = await db.query("SELECT name, oab_number, oab_uf FROM lawyers WHERE active = 1 ORDER BY id LIMIT 1") as any;

  const money = (v: number) => `R$ ${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const dataExtenso = () => new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  const empresaAdvogadoTexto = a.opposing_lawyer_name
    ? `, neste ato assistida por seu advogado ${a.opposing_lawyer_name}${a.opposing_lawyer_oab ? ` (OAB ${a.opposing_lawyer_oab})` : ''}`
    : '';
  const clausulaPenal = a.penalty_percentage
    ? `4 - DA CLÁUSULA PENAL\nCláusula 4ª. Em caso de descumprimento de qualquer obrigação prevista neste instrumento, incidirá multa de ${Number(a.penalty_percentage)}% sobre o valor da parcela vencida e não paga, sem prejuízo de correção monetária e juros legais.`
    : '';

  const map: Record<string, string> = {
    cliente_nome: client.name || '',
    cliente_cpf: client.cpf_cnpj || '',
    cliente_endereco: client.address || '',
    cliente_cidade: client.city || '',
    cliente_estado: client.state || '',
    cliente_profissao: client.profession || '',
    cliente_estado_civil: client.marital_status || '',
    advogada_nome: lawyer?.name || '',
    advogada_oab: lawyer ? `${lawyer.oab_number || ''}${lawyer.oab_uf ? '/' + lawyer.oab_uf : ''}` : '',
    empresa_nome: a.opposing_party || '',
    empresa_cnpj: a.opposing_cnpj || '',
    empresa_endereco: a.opposing_address || '',
    empresa_representante_nome: a.opposing_legal_rep_name || '',
    empresa_representante_cpf: a.opposing_legal_rep_cpf || '',
    empresa_advogado_texto: empresaAdvogadoTexto,
    acordo_objeto: a.agreement_object || '',
    acordo_valor_total: money(a.total_agreement_value),
    acordo_forma_pagamento: a.payment_method || 'a combinar entre as partes',
    acordo_cronograma: cronogramaAcordoTexto(montarCronogramaAcordo(a)),
    acordo_clausula_penal: clausulaPenal,
    acordo_foro: a.jurisdiction_forum || client.city || '',
    data_extenso: dataExtenso(),
  };
  const content = String(tpl.content).replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => (map[k] !== undefined ? map[k] : ''));

  const [r] = await db.query(
    `INSERT INTO documents (client_id, case_id, name, type, folder, content, template_id, status, created_by)
     VALUES (?, ?, ?, 'gerado', ?, ?, ?, 'pendente', ?)`,
    [a.client_id, a.case_id ?? null, tpl.name, tpl.category, content, tpl.id, req.user!.id]
  ) as any;

  await logTimeline({
    clientId: a.client_id, caseId: a.case_id ?? null, eventType: 'documento_gerado',
    description: `Termo de acordo extrajudicial gerado — ${a.opposing_party}`, userId: req.user!.id,
  }).catch(() => {});

  const [rows] = await db.query('SELECT * FROM documents WHERE id = ?', [r.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── POST /api/acordos/:id/minuta — upload de minuta própria (arquivo) ───────
// Sem multer no projeto: o front lê o arquivo como base64 e manda em JSON
// (o limite global de express.json já é 20mb, de sobra pra um docx/pdf).
router.post('/:id/minuta', async (req: Request, res: Response) => {
  const { file_base64, file_name, mime } = req.body || {};
  if (!file_base64 || !file_name) { res.status(400).json({ error: 'file_base64 e file_name são obrigatórios' }); return; }
  const [[a]] = await db.query('SELECT * FROM agreements WHERE id = ?', [req.params.id]) as any;
  if (!a) { res.status(404).json({ error: 'Acordo não encontrado' }); return; }

  const buffer = Buffer.from(stripDataUrlPrefix(file_base64), 'base64');
  const MAX = 15 * 1024 * 1024;
  if (buffer.length > MAX) { res.status(400).json({ error: 'Arquivo maior que 15MB' }); return; }

  const [r] = await db.query(
    `INSERT INTO documents (client_id, case_id, name, type, folder, data, mime, status, created_by)
     VALUES (?, ?, ?, 'minuta_propria', 'acordos', ?, ?, 'recebido', ?)`,
    [a.client_id, a.case_id ?? null, file_name, buffer, mime || 'application/octet-stream', req.user!.id]
  ) as any;
  await db.query('UPDATE agreements SET minuta_document_id = ? WHERE id = ?', [r.insertId, a.id]);

  await logTimeline({
    clientId: a.client_id, caseId: a.case_id ?? null, eventType: 'documento_gerado',
    description: `Minuta enviada para o acordo — ${a.opposing_party} (${file_name})`, userId: req.user!.id,
  }).catch(() => {});

  res.status(201).json({ document_id: r.insertId, file_name, mime: mime || 'application/octet-stream' });
});

// ── GET /api/acordos/:id/minuta — baixa a minuta enviada (autenticado) ──────
router.get('/:id/minuta', async (req: Request, res: Response) => {
  const [[a]] = await db.query('SELECT minuta_document_id FROM agreements WHERE id = ?', [req.params.id]) as any;
  if (!a || !a.minuta_document_id) { res.status(404).json({ error: 'Este acordo não tem minuta enviada' }); return; }
  const [[doc]] = await db.query('SELECT name, mime, data FROM documents WHERE id = ?', [a.minuta_document_id]) as any;
  if (!doc || !doc.data) { res.status(404).json({ error: 'Arquivo não encontrado' }); return; }
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.name)}"`);
  res.send(doc.data);
});

// ── POST /api/acordos — criar ───────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const {
    client_id, case_id, process_number, opposing_party,
    total_agreement_value, entrada_value, entrada_date, installments_count, first_due_date,
    honorarium_percentage, honorarium_value, sucumbencia_value, sucumbencia_due_date,
    receiving_method, notes,
    is_extrajudicial, opposing_cnpj, opposing_address, opposing_legal_rep_name, opposing_legal_rep_cpf,
    opposing_lawyer_name, opposing_lawyer_oab, payment_method, payment_flow, agreement_object,
    penalty_percentage, jurisdiction_forum,
  } = req.body;

  if (!client_id) { res.status(400).json({ error: 'client_id é obrigatório' }); return; }
  if (!opposing_party || !String(opposing_party).trim()) { res.status(400).json({ error: 'opposing_party é obrigatório' }); return; }
  if (!first_due_date) { res.status(400).json({ error: 'first_due_date é obrigatória' }); return; }

  const totalValue = Number(total_agreement_value) || 0;
  const honPct = Number(honorarium_percentage) || 0;
  const honValue = honorarium_value !== undefined ? Number(honorarium_value) : round2((totalValue * honPct) / 100);
  const flow = PAYMENT_FLOWS.includes(payment_flow) ? payment_flow : 'direto_cliente';
  const penalty = penalty_percentage !== undefined && penalty_percentage !== null && penalty_percentage !== ''
    ? Number(penalty_percentage) : null;

  const [result] = await db.query(
    `INSERT INTO agreements
       (client_id, case_id, process_number, opposing_party, total_agreement_value, entrada_value, entrada_date,
        installments_count, first_due_date, honorarium_percentage, honorarium_value,
        sucumbencia_value, sucumbencia_due_date, receiving_method, status, notes,
        is_extrajudicial, opposing_cnpj, opposing_address, opposing_legal_rep_name, opposing_legal_rep_cpf,
        opposing_lawyer_name, opposing_lawyer_oab, payment_method, payment_flow, agreement_object,
        penalty_percentage, jurisdiction_forum)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Proposto', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [client_id, case_id ?? null, process_number ?? null, opposing_party.trim(), totalValue,
     round2(entrada_value), entrada_date || null, Number(installments_count) || 1, first_due_date, honPct, honValue,
     round2(sucumbencia_value), sucumbencia_due_date || null,
     receiving_method || 'Acordo', notes ?? null,
     is_extrajudicial ? 1 : 0, opposing_cnpj || null, opposing_address || null,
     opposing_legal_rep_name || null, opposing_legal_rep_cpf || null,
     opposing_lawyer_name || null, opposing_lawyer_oab || null,
     payment_method || null, flow, agreement_object || null, penalty, jurisdiction_forum || null]
  ) as any;

  await logFinancialAudit({
    entityType: 'Agreement', entityId: result.insertId, action: 'created',
    userId: req.user!.id, userName: req.user!.name, clientId: client_id, caseId: case_id ?? null,
    agreementId: result.insertId, newValue: totalValue, newStatus: 'Proposto',
    reason: `Acordo criado: ${opposing_party} — R$ ${totalValue}`, ipAddress: req.ip,
  });

  const { lancados } = await syncAgreementFinanceLaunches(result.insertId, req.user!.id).catch((e) => { console.error('❌ [acordo-financeiro] falha ao lançar honorários (create):', e?.message || e); return { lancados: 0 }; });
  await syncAgreementClientPayouts(result.insertId).catch((e) => console.error('❌ [acordo-repasses] falha ao gerar repasses (create):', e?.message || e));

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
  setIf('is_extrajudicial', req.body.is_extrajudicial !== undefined ? (req.body.is_extrajudicial ? 1 : 0) : undefined);
  setIf('opposing_cnpj', req.body.opposing_cnpj);
  setIf('opposing_address', req.body.opposing_address);
  setIf('opposing_legal_rep_name', req.body.opposing_legal_rep_name);
  setIf('opposing_legal_rep_cpf', req.body.opposing_legal_rep_cpf);
  setIf('opposing_lawyer_name', req.body.opposing_lawyer_name);
  setIf('opposing_lawyer_oab', req.body.opposing_lawyer_oab);
  setIf('payment_method', req.body.payment_method);
  setIf('payment_flow', req.body.payment_flow, PAYMENT_FLOWS.includes(req.body.payment_flow));
  setIf('agreement_object', req.body.agreement_object);
  setIf('penalty_percentage', req.body.penalty_percentage !== undefined
    ? (req.body.penalty_percentage === null || req.body.penalty_percentage === '' ? null : Number(req.body.penalty_percentage))
    : undefined);
  setIf('jurisdiction_forum', req.body.jurisdiction_forum);

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
  await syncAgreementClientPayouts(Number(id)).catch((e) => console.error('❌ [acordo-repasses] falha ao gerar repasses (update):', e?.message || e));

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
