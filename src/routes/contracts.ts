import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../config/database';
import { logTimeline } from '../services/TimelineService';
import { onContractSigned } from '../services/contractFlow';
import { buildTemplate, buildProcuracao, buildDeclaracao, montarEndereco, PartyData } from '../services/contractTemplates';

const router = Router();

const AREAS = ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro'];
const STATUSES = ['rascunho', 'em_producao', 'finalizado', 'enviado_assinatura', 'assinado', 'cancelado'];

// ── GET /api/contracts ──────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const status = req.query.status as string;
  const where: string[] = ['ct.user_id = ?'];
  const params: any[] = [req.user!.id];
  if (status && STATUSES.includes(status)) { where.push('ct.status = ?'); params.push(status); }

  const [rows] = await db.query(
    `SELECT ct.id, ct.title, ct.area, ct.value, ct.status, ct.created_at, c.name AS client_name
     FROM contracts ct LEFT JOIN clients c ON c.id = ct.client_id
     WHERE ${where.join(' AND ')} ORDER BY ct.created_at DESC`,
    params
  ) as any;
  res.json(rows);
});

// ── GET /api/contracts/:id ──────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT ct.*, c.name AS client_name FROM contracts ct
     LEFT JOIN clients c ON c.id = ct.client_id WHERE ct.id = ? AND ct.user_id = ?`,
    [req.params.id, req.user!.id]
  ) as any;
  if (!rows.length) { res.status(404).json({ error: 'Contrato não encontrado' }); return; }
  res.json(rows[0]);
});

// ── GET /api/contracts/:id/party — dados já cadastrados da parte (lead + cliente) ─
router.get('/:id/party', async (req: Request, res: Response) => {
  const [cts] = await db.query('SELECT client_id, lead_id FROM contracts WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]) as any;
  if (!cts.length) { res.status(404).json({ error: 'Contrato não encontrado' }); return; }
  const ct = cts[0];

  let lead: any = null, client: any = null;
  if (ct.lead_id) {
    const [lr] = await db.query(
      'SELECT name, cpf_cnpj, rg, marital_status, profession, cep, street, number, neighborhood, city, state, phone, email FROM leads WHERE id = ?',
      [ct.lead_id]
    ) as any;
    lead = lr[0] || null;
  }
  if (ct.client_id) {
    const [cr] = await db.query('SELECT name, cpf_cnpj, address, phone, email FROM clients WHERE id = ?', [ct.client_id]) as any;
    client = cr[0] || null;
  }
  res.json({
    name: client?.name || lead?.name || '',
    cpf: client?.cpf_cnpj || lead?.cpf_cnpj || '',
    rg: lead?.rg || '',
    estado_civil: lead?.marital_status || '',
    profissao: lead?.profession || '',
    endereco: (client?.address && client.address.trim()) ? client.address : (montarEndereco(lead || {}) || ''),
  });
});

// ── POST /api/contracts/from-lead/:leadId — fecha o lead e gera o contrato ──
router.post('/from-lead/:leadId', async (req: Request, res: Response) => {
  const { leadId } = req.params;
  const [leads] = await db.query('SELECT * FROM leads WHERE id = ? AND user_id = ?', [leadId, req.user!.id]) as any;
  if (!leads.length) { res.status(404).json({ error: 'Lead não encontrado' }); return; }
  const lead = leads[0];

  // já existe contrato para este lead?
  const [existing] = await db.query('SELECT id FROM contracts WHERE lead_id = ?', [leadId]) as any;
  if (existing.length) {
    await db.query("UPDATE leads SET status = 'fechada', analise_since = NULL WHERE id = ?", [leadId]);
    res.status(200).json({ id: existing[0].id, alreadyExisted: true });
    return;
  }

  const area = AREAS.includes(lead.legal_area) ? lead.legal_area : 'outro';
  const party: PartyData = {
    name: lead.name, cpf: lead.cpf_cnpj, rg: lead.rg,
    estadoCivil: lead.marital_status, profissao: lead.profession, endereco: montarEndereco(lead),
  };
  const content = buildTemplate({ party, area, value: req.body.value });

  const [result] = await db.query(
    `INSERT INTO contracts (user_id, client_id, lead_id, area, title, content, procuracao_content, declaracao_content, value, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'rascunho')`,
    [req.user!.id, lead.client_id ?? null, leadId, area,
     `Contrato — ${lead.name}`, content, buildProcuracao(party), buildDeclaracao(party), req.body.value ?? null]
  ) as any;

  await db.query("UPDATE leads SET status = 'fechada', analise_since = NULL WHERE id = ?", [leadId]);

  if (lead.client_id) {
    await logTimeline({ clientId: lead.client_id, contractId: result.insertId, eventType: 'contrato_gerado',
      description: 'Contrato, procuração e declaração de hipossuficiência gerados.', userId: req.user!.id });
  }

  const [rows] = await db.query('SELECT * FROM contracts WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── POST /api/contracts — criar manual (modelo por área) ────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { client_id, title, area, value, content } = req.body;
  const finalArea = AREAS.includes(area) ? area : 'outro';

  let clientName = '';
  let party: PartyData = {};
  if (client_id) {
    const [c] = await db.query('SELECT name, cpf_cnpj, address FROM clients WHERE id = ?', [client_id]) as any;
    clientName = c[0]?.name ?? '';
    party = { name: clientName, cpf: c[0]?.cpf_cnpj, endereco: montarEndereco(c[0] || {}) };
  }
  const finalContent = content || buildTemplate({ party, area: finalArea, value });

  const [result] = await db.query(
    `INSERT INTO contracts (user_id, client_id, area, title, content, procuracao_content, declaracao_content, value, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'rascunho')`,
    [req.user!.id, client_id ?? null, finalArea, title || `Contrato — ${clientName || finalArea}`,
     finalContent, buildProcuracao(party), buildDeclaracao(party), value ?? null]
  ) as any;
  const [rows] = await db.query('SELECT * FROM contracts WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── PUT /api/contracts/:id — editar conteúdo/status ─────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existingRows] = await db.query('SELECT * FROM contracts WHERE id = ? AND user_id = ?', [id, req.user!.id]) as any;
  if (!existingRows.length) { res.status(404).json({ error: 'Contrato não encontrado' }); return; }
  const before = existingRows[0];

  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };
  setIf('title', req.body.title);
  setIf('content', req.body.content);
  setIf('procuracao_content', req.body.procuracao_content);
  setIf('declaracao_content', req.body.declaracao_content);
  setIf('value', req.body.value !== undefined ? Number(req.body.value) : undefined);
  setIf('area', req.body.area, AREAS.includes(req.body.area));
  setIf('status', req.body.status, STATUSES.includes(req.body.status));

  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido para atualizar' }); return; }
  params.push(id);
  await db.query(`UPDATE contracts SET ${fields.join(', ')} WHERE id = ?`, params);

  // Ao ASSINAR: cria o processo na esteira + gera honorários no financeiro (sem retrabalho)
  let createdCaseId: number | null = null;
  if (req.body.status === 'assinado' && before.status !== 'assinado' && before.client_id) {
    const r = await onContractSigned(Number(id), req.user!.id, req.user!.name);
    createdCaseId = r.caseId;
  } else if (req.body.status === 'enviado_assinatura' && before.status !== 'enviado_assinatura' && before.client_id) {
    await logTimeline({ clientId: before.client_id, contractId: Number(id),
      eventType: 'contrato_enviado', description: 'Contrato enviado para assinatura.', userId: req.user!.id });
  }

  const [rows] = await db.query('SELECT * FROM contracts WHERE id = ?', [id]) as any;
  res.json({ ...rows[0], created_case_id: createdCaseId });
});

// ── Assinatura eletrônica do contrato (link público) ────────────────────────
router.post('/:id/sign-request', async (req: Request, res: Response) => {
  const [[ct]] = await db.query('SELECT id, content FROM contracts WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]) as any;
  if (!ct) { res.status(404).json({ error: 'Contrato não encontrado' }); return; }
  const token = crypto.randomUUID();
  const code = crypto.randomBytes(5).toString('hex').toUpperCase();
  await db.query(
    `INSERT INTO signature_requests (contract_id, token, verification_code, signer_name, signer_cpf, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [req.params.id, token, code, req.body?.signer_name ?? null, req.body?.signer_cpf ?? null, req.user!.id]
  );
  // marca o contrato como enviado para assinatura
  await db.query("UPDATE contracts SET status = 'enviado_assinatura' WHERE id = ? AND status <> 'assinado'", [req.params.id]);
  res.status(201).json({ token, verification_code: code, path: `/assinar.html?token=${token}` });
});

router.get('/:id/signatures', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT id, token, verification_code, signer_name, status, signed_at FROM signature_requests
      WHERE contract_id = ? ORDER BY created_at DESC`, [req.params.id]
  ) as any;
  res.json(rows);
});

export default router;
