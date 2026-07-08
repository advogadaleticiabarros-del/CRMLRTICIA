import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../config/database';
import { logTimeline } from '../services/TimelineService';
import { logActivity } from '../services/JourneyService';
import { notificationService } from '../services/NotificationService';
import { montarEndereco } from '../services/contractTemplates';
import { buildPeticaoInicial, analyzeCaseDrive } from '../services/peticaoBuilder';
import { revisarPeticaoDoCaso } from '../services/peticaoReviewer';

const router = Router();

const AREAS = ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro'];
const PHASES = ['inicial', 'instrucao', 'sentenca', 'recurso', 'execucao', 'encerrado'];
const STATUSES = ['ativo', 'suspenso', 'encerrado'];
const PROD_STAGES = ['separacao_documentos', 'criacao_inicial', 'revisao_inicial', 'aguardando_protocolo', 'protocolado', 'concluido'];
const STAGE_LABELS: Record<string, string> = {
  separacao_documentos: 'Separação de documentos', criacao_inicial: 'Criação inicial',
  revisao_inicial: 'Revisão inicial', aguardando_protocolo: 'Aguardando protocolo',
  protocolado: 'Protocolado', concluido: 'Concluído',
};

// ── GET /api/cases — lista com filtros e paginação ──────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const search   = (req.query.search as string)?.trim();
  const status   = req.query.status as string;
  const area     = req.query.area as string;
  const clientId = req.query.client_id as string;
  const page     = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit    = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset   = (page - 1) * limit;

  const where: string[] = [];
  const params: any[] = [];
  // Visibilidade por papel: admin/advogado veem todos; estagiário/parceiro só os atribuídos.
  const role = req.user!.role;
  if (role === 'estagiario' || role === 'parceiro') {
    where.push('c.id IN (SELECT case_id FROM case_collaborators WHERE user_id = ?)');
    params.push(req.user!.id);
  }
  if (search)   { where.push('(c.title LIKE ? OR c.case_number LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (status && STATUSES.includes(status)) { where.push('c.status = ?'); params.push(status); }
  if (area && AREAS.includes(area))         { where.push('c.legal_area = ?'); params.push(area); }
  if (clientId) { where.push('c.client_id = ?'); params.push(clientId); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM cases c ${whereSql}`, params) as any;

  const [rows] = await db.query(
    `SELECT c.id, c.case_number, c.title, c.legal_area, c.phase, c.status, c.production_stage, c.created_at, cl.name AS client_name
     FROM cases c LEFT JOIN clients cl ON cl.id = c.client_id
     ${whereSql} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as any;

  res.json({ data: rows, total, page, limit, pages: Math.ceil(total / limit) });
});

// ── GET /api/cases/production-board — quadro Kanban da produção (com SLA) ────
router.get('/production-board', async (_req: Request, res: Response) => {
  const [rows] = await db.query(`
    SELECT c.id, c.case_number, c.title, c.legal_area, c.production_stage,
           c.production_started_at, c.production_labels,
           DATEDIFF(NOW(), c.production_started_at) AS sla_days,
           cl.name AS client_name,
           u.name  AS assignee_name,
           (SELECT COUNT(*) FROM production_notes pn
             WHERE pn.case_id = c.id AND pn.kind = 'pendencia' AND pn.resolved = 0) AS pendencias
      FROM cases c
      LEFT JOIN clients cl ON cl.id = c.client_id
      LEFT JOIN users   u  ON u.id  = c.production_assignee
     WHERE c.production_stage IS NOT NULL
     ORDER BY c.production_started_at ASC
  `) as any;
  res.json(rows);
});

// ── GET /api/cases/:id/ficha — ficha completa do processo (tudo consolidado) ─
router.get('/:id/ficha', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [[c]] = await db.query(
    `SELECT c.*, cl.name AS client_name, cl.cpf_cnpj, cl.email AS client_email, cl.phone AS client_phone,
            cl.address AS client_address, u.name AS assignee_name, p.name AS partner_name
       FROM cases c
       LEFT JOIN clients cl ON cl.id = c.client_id
       LEFT JOIN users u ON u.id = c.production_assignee
       LEFT JOIN partners p ON p.id = c.partner_id
      WHERE c.id = ?`, [id]
  ) as any;
  if (!c) { res.status(404).json({ error: 'Processo não encontrado' }); return; }

  // Qualificação (cabeçalho) — busca o lead de origem via contrato, se houver.
  let lead: any = null;
  if (c.origin_contract_id) {
    const [[ct]] = await db.query('SELECT lead_id FROM contracts WHERE id = ?', [c.origin_contract_id]) as any;
    if (ct?.lead_id) {
      const [[lr]] = await db.query('SELECT rg, marital_status, profession, case_summary, cep, street, number, neighborhood, city, state FROM leads WHERE id = ?', [ct.lead_id]) as any;
      lead = lr || null;
    }
  }
  const endereco = (c.client_address && String(c.client_address).trim()) ? c.client_address : (montarEndereco(lead || {}) || '');
  const qualificacao = [
    c.client_name, 'brasileiro(a)', lead?.marital_status || '', lead?.profession || '',
    lead?.rg ? `portador(a) do RG nº ${lead.rg}` : '',
    c.cpf_cnpj ? `inscrito(a) no CPF nº ${c.cpf_cnpj}` : '',
    endereco ? `residente e domiciliado(a) em ${endereco}` : '',
    c.client_email ? `e-mail: ${c.client_email}` : '',
  ].filter((x) => x && String(x).trim()).join(', ');

  const q = async (sql: string) => { const [r] = await db.query(sql, [id]) as any; return r; };
  const [notes, movements, deadlines, documents, installments, receitas] = await Promise.all([
    q('SELECT kind, text, author_name, resolved, created_at FROM production_notes WHERE case_id = ? ORDER BY created_at ASC').catch(() => []),
    q('SELECT description, movement_date, created_at FROM case_movements WHERE case_id = ? ORDER BY COALESCE(movement_date, created_at) DESC').catch(() => []),
    q("SELECT description, deadline_date, status, priority FROM deadlines WHERE case_id = ? ORDER BY deadline_date ASC").catch(() => []),
    q("SELECT name, type, folder, status, created_at FROM documents WHERE case_id = ? ORDER BY created_at DESC").catch(() => []),
    q('SELECT numero, valor, due_date, status FROM installments WHERE case_id = ? ORDER BY numero ASC').catch(() => []),
    q("SELECT description, valor, tipo, status, due_date FROM financial_records WHERE case_id = ? ORDER BY due_date ASC").catch(() => []),
  ]);

  res.json({
    case: {
      id: c.id, title: c.title, case_number: c.case_number, legal_area: c.legal_area, phase: c.phase,
      status: c.status, production_stage: c.production_stage, production_started_at: c.production_started_at,
      production_labels: c.production_labels, assignee_name: c.assignee_name, partner_name: c.partner_name,
      description: c.description, created_at: c.created_at,
    },
    client: { name: c.client_name, cpf_cnpj: c.cpf_cnpj, email: c.client_email, phone: c.client_phone, address: endereco },
    header: { qualificacao },
    case_summary: lead?.case_summary || c.description || '',
    notes, movements, deadlines, documents, installments, receitas,
  });
});

// ── GET /api/cases/:id/production — painel de produção (resumo, cabeçalho, notas) ─
router.get('/:id/production', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [[c]] = await db.query(
    `SELECT c.*, cl.name AS client_name, cl.cpf_cnpj, cl.email AS client_email, cl.address AS client_address
       FROM cases c LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?`, [id]
  ) as any;
  if (!c) { res.status(404).json({ error: 'Processo não encontrado' }); return; }

  // Lead de origem (via contrato) — traz qualificação e resumo do caso.
  let lead: any = null; let originLeadId: number | null = null;
  if (c.origin_contract_id) {
    const [[ct]] = await db.query('SELECT lead_id FROM contracts WHERE id = ?', [c.origin_contract_id]) as any;
    if (ct?.lead_id) {
      originLeadId = ct.lead_id;
      const [[lr]] = await db.query('SELECT name, cpf_cnpj, rg, marital_status, profession, email, case_summary, cep, street, number, neighborhood, city, state FROM leads WHERE id = ?', [ct.lead_id]) as any;
      lead = lr || null;
    }
  }

  const nome = c.client_name || lead?.name || '';
  const cpf = c.cpf_cnpj || lead?.cpf_cnpj || '';
  const email = c.client_email || lead?.email || '';
  const endereco = (c.client_address && String(c.client_address).trim()) ? c.client_address : (montarEndereco(lead || {}) || '');
  const partes = [
    nome, 'brasileiro(a)', lead?.marital_status || '', lead?.profession || '',
    lead?.rg ? `portador(a) do RG nº ${lead.rg}` : '',
    cpf ? `inscrito(a) no CPF nº ${cpf}` : '',
    endereco ? `residente e domiciliado(a) em ${endereco}` : '',
    email ? `e-mail: ${email}` : '',
  ].filter((x) => x && String(x).trim());
  const header = { nome, estado_civil: lead?.marital_status || '', profissao: lead?.profession || '', rg: lead?.rg || '', cpf, endereco, email, qualificacao: partes.join(', ') };

  const [notes] = await db.query(
    `SELECT id, kind, text, author_name, resolved, resolved_at, created_at
       FROM production_notes WHERE case_id = ? ORDER BY created_at DESC`, [id]
  ).catch(() => [[]]) as any;

  // Jornada completa do caso: eventos do próprio caso + os da fase de lead (origem).
  const [journey] = await db.query(
    `SELECT event_type, title, description, actor_name, created_at
       FROM journey_log
      WHERE case_id = ? OR (? IS NOT NULL AND lead_id = ?)
      ORDER BY created_at DESC LIMIT 200`, [id, originLeadId, originLeadId]
  ).catch(() => [[]]) as any;

  res.json({
    production_stage: c.production_stage, production_started_at: c.production_started_at,
    production_labels: c.production_labels, production_assignee: c.production_assignee,
    drive_folder_url: c.drive_folder_url || '',
    case_summary: lead?.case_summary || c.description || '',
    header, notes, journey,
  });
});

// ── POST /api/cases/:id/contexto — acrescenta atualização ao caso (append) ───
router.post('/:id/contexto', async (req: Request, res: Response) => {
  const text = String(req.body?.text || '').trim();
  if (!text) { res.status(400).json({ error: 'Escreva a atualização' }); return; }
  const [[c]] = await db.query('SELECT client_id FROM cases WHERE id = ?', [req.params.id]) as any;
  if (!c) { res.status(404).json({ error: 'Processo não encontrado' }); return; }
  await logActivity({
    caseId: Number(req.params.id), clientId: c.client_id ?? null,
    actorId: req.user!.id, actorName: req.user!.name,
    eventType: 'contexto_atualizado', title: 'Atualização do caso', description: text,
  });
  res.status(201).json({ success: true });
});

// ── POST /api/cases/:id/peticao-inicial — gera uma NOVA VERSÃO da petição ────
// Regeração manual: cria v2, v3… (preserva as anteriores para comparação).
router.post('/:id/peticao-inicial', async (req: Request, res: Response) => {
  try {
    const r = await buildPeticaoInicial(Number(req.params.id), req.user!.id, true);
    if (!r.ok) { res.status(400).json({ error: r.message || 'Não foi possível gerar' }); return; }
    res.json({ success: true, ...r });
  } catch (e: any) { res.status(400).json({ error: e?.message || 'Falha ao gerar a petição' }); }
});

// ── PATCH /api/cases/:id/production-meta — etiquetas e responsável ───────────
router.patch('/:id/production-meta', async (req: Request, res: Response) => {
  try {
    const { labels, assignee, drive_folder_url } = req.body;
    const sets: string[] = []; const params: any[] = [];
    if (labels !== undefined) { sets.push('production_labels = ?'); params.push(Array.isArray(labels) ? JSON.stringify(labels) : null); }
    if (assignee !== undefined) { sets.push('production_assignee = ?'); params.push(assignee || null); }
    if (drive_folder_url !== undefined) { sets.push('drive_folder_url = ?'); params.push(drive_folder_url ? String(drive_folder_url).trim() : null); }
    if (!sets.length) { res.status(400).json({ error: 'Nada para atualizar' }); return; }
    params.push(req.params.id);
    await db.query(`UPDATE cases SET ${sets.join(', ')} WHERE id = ?`, params);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Erro ao atualizar metadados' }); }
});

// ── POST /api/cases/:id/analisar-documentos — lê a pasta do Drive e gera a análise-checklist
router.post('/:id/analisar-documentos', async (req: Request, res: Response) => {
  try {
    const r = await analyzeCaseDrive(Number(req.params.id), req.user!.id);
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ ok: false, message: e?.message || 'Falha ao analisar os documentos' });
  }
});

// ── POST /api/cases/:id/production-notes — observação/pendência/atualização ──
router.post('/:id/production-notes', async (req: Request, res: Response) => {
  try {
    const { kind, text } = req.body;
    const k = ['observacao', 'pendencia', 'atualizacao'].includes(kind) ? kind : 'observacao';
    if (!text || !String(text).trim()) { res.status(400).json({ error: 'Escreva o texto' }); return; }
    const [r] = await db.query(
      'INSERT INTO production_notes (case_id, user_id, author_name, kind, text) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, req.user!.id, req.user!.name, k, String(text).trim()]
    ) as any;
    res.status(201).json({ id: r.insertId });
  } catch (err: any) { res.status(500).json({ error: err?.message || 'Erro ao salvar nota' }); }
});

// ── PATCH /api/cases/production-notes/:noteId/resolve — resolve pendência ────
router.patch('/production-notes/:noteId/resolve', async (req: Request, res: Response) => {
  await db.query("UPDATE production_notes SET resolved = 1, resolved_at = NOW() WHERE id = ?", [req.params.noteId]);
  res.json({ success: true });
});

// ── GET /api/cases/:id — detalhe com movimentações e resumo ─────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [rows] = await db.query(
    `SELECT c.*, cl.name AS client_name FROM cases c
     LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?`, [id]
  ) as any;
  if (!rows.length) { res.status(404).json({ error: 'Processo não encontrado' }); return; }

  const [movements] = await db.query(
    'SELECT id, description, movement_date, created_at FROM case_movements WHERE case_id = ? ORDER BY COALESCE(movement_date, created_at) DESC LIMIT 50',
    [id]
  ) as any;

  const [[resumo]] = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM deadlines WHERE case_id = ? AND status = 'pendente') AS prazos_pendentes,
      (SELECT COUNT(*) FROM legal_pieces WHERE case_id = ? AND status NOT IN ('protocolado','cancelado')) AS pecas_pendentes
  `, [id, id]) as any;

  res.json({ ...rows[0], movements, resumo });
});

// ── POST /api/cases — criar ─────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { client_id, case_number, title, legal_area, phase, status, description } = req.body;
  if (!client_id) { res.status(400).json({ error: 'client_id é obrigatório' }); return; }
  if (!title || !String(title).trim()) { res.status(400).json({ error: 'O título é obrigatório' }); return; }

  const [result] = await db.query(
    `INSERT INTO cases (user_id, client_id, case_number, title, legal_area, phase, status, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user!.id, client_id, case_number ?? null, title.trim(),
      AREAS.includes(legal_area) ? legal_area : 'outro',
      PHASES.includes(phase) ? phase : 'inicial',
      STATUSES.includes(status) ? status : 'ativo',
      description ?? null,
    ]
  ) as any;

  const [rows] = await db.query('SELECT * FROM cases WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── PUT /api/cases/:id ──────────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT id FROM cases WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Processo não encontrado' }); return; }

  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };
  setIf('title', req.body.title?.trim?.());
  setIf('case_number', req.body.case_number);
  setIf('legal_area', req.body.legal_area, AREAS.includes(req.body.legal_area));
  setIf('phase', req.body.phase, PHASES.includes(req.body.phase));
  setIf('status', req.body.status, STATUSES.includes(req.body.status));
  setIf('description', req.body.description);

  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido para atualizar' }); return; }
  params.push(id);
  await db.query(`UPDATE cases SET ${fields.join(', ')} WHERE id = ?`, params);

  const [rows] = await db.query('SELECT * FROM cases WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

// ── GET /api/cases/:id/collaborators — quem trabalha no processo ────────────
router.get('/:id/collaborators', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT cc.id, cc.user_id, cc.role, cc.commission_percent, u.name, u.role AS user_role
     FROM case_collaborators cc JOIN users u ON u.id = cc.user_id
     WHERE cc.case_id = ? ORDER BY cc.role, u.name`,
    [req.params.id]
  ) as any;
  res.json(rows);
});

// ── POST /api/cases/:id/collaborators — atribuir estagiário/parceiro ────────
router.post('/:id/collaborators', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { user_id, role, commission_percent } = req.body;
  if (!user_id) { res.status(400).json({ error: 'user_id é obrigatório' }); return; }

  const [u] = await db.query("SELECT role, commission_percent FROM users WHERE id = ?", [user_id]) as any;
  if (!u.length) { res.status(404).json({ error: 'Usuário não encontrado' }); return; }

  // repasse: usa o informado, ou o padrão do parceiro
  const commission = commission_percent ?? (u[0].role === 'parceiro' ? u[0].commission_percent : null);

  await db.query(
    `INSERT INTO case_collaborators (case_id, user_id, role, commission_percent)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE role = VALUES(role), commission_percent = VALUES(commission_percent)`,
    [id, user_id, role === 'responsavel' ? 'responsavel' : 'colaborador', commission]
  );
  res.status(201).json({ success: true });
});

// ── DELETE /api/cases/:id — apagar demanda (bloqueado se houver parcelas pagas)
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [[{ paid }]] = await db.query(
    "SELECT COUNT(*) AS paid FROM installments WHERE case_id = ? AND status = 'pago'", [id]
  ) as any;
  if (Number(paid) > 0) {
    res.status(409).json({ error: 'Não é possível apagar um processo com parcelas pagas.' });
    return;
  }
  const [r] = await db.query('DELETE FROM cases WHERE id = ?', [id]) as any;
  if (!r.affectedRows) { res.status(404).json({ error: 'Processo não encontrado' }); return; }
  res.json({ success: true, id: Number(id) });
});

// ── DELETE /api/cases/:id/collaborators/:userId ─────────────────────────────
router.delete('/:id/collaborators/:userId', async (req: Request, res: Response) => {
  await db.query('DELETE FROM case_collaborators WHERE case_id = ? AND user_id = ?', [req.params.id, req.params.userId]);
  res.json({ success: true });
});

// ── POST /api/cases/:id/movements — registrar movimentação ──────────────────
router.post('/:id/movements', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { description, movement_date } = req.body;
  if (!description || !String(description).trim()) {
    res.status(400).json({ error: 'A descrição da movimentação é obrigatória' }); return;
  }

  const [cases] = await db.query('SELECT client_id FROM cases WHERE id = ?', [id]) as any;
  if (!cases.length) { res.status(404).json({ error: 'Processo não encontrado' }); return; }

  const [result] = await db.query(
    'INSERT INTO case_movements (case_id, client_id, description, movement_date) VALUES (?, ?, ?, ?)',
    [id, cases[0].client_id, description.trim(), movement_date || null]
  ) as any;

  const [rows] = await db.query('SELECT * FROM case_movements WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── PATCH /api/cases/:id/production-stage — move na esteira de produção ─────
router.patch('/:id/production-stage', async (req: Request, res: Response) => {
  try {
  const { id } = req.params;
  const { stage, case_number } = req.body;
  if (!PROD_STAGES.includes(stage)) {
    res.status(400).json({ error: `stage deve ser: ${PROD_STAGES.join(', ')}` }); return;
  }

  const [rows] = await db.query('SELECT * FROM cases WHERE id = ?', [id]) as any;
  if (!rows.length) { res.status(404).json({ error: 'Processo não encontrado' }); return; }
  const c = rows[0];

  // TRAVA: só vai para "protocolado" com o número do processo
  if (stage === 'protocolado' && !(case_number && String(case_number).trim()) && !c.case_number) {
    res.status(400).json({ error: 'Para protocolar, informe o número do processo/protocolo.' });
    return;
  }

  const finalCaseNumber = (case_number && String(case_number).trim()) ? case_number.trim() : c.case_number;
  // Marca o início da produção (SLA total) na primeira vez que entra na esteira.
  await db.query(
    'UPDATE cases SET production_stage = ?, case_number = ?, production_started_at = COALESCE(production_started_at, NOW()) WHERE id = ?',
    [stage, finalCaseNumber, id]
  );

  try {
    await logTimeline({
      clientId: c.client_id, caseId: Number(id), eventType: `etapa_${stage}`,
      description: `Produção movida para: ${STAGE_LABELS[stage]}${stage === 'protocolado' ? ` — processo nº ${finalCaseNumber}` : ''}.`,
      userId: req.user!.id,
    });
  } catch { /* timeline não crítica */ }

  // Registra a movimentação no log de produção (de → para), por quem moveu.
  if (c.production_stage !== stage) {
    try {
      await db.query(
        `INSERT INTO production_notes (case_id, user_id, author_name, kind, text)
         VALUES (?, ?, ?, 'atualizacao', ?)`,
        [id, req.user!.id, req.user!.name,
         `Movido na esteira: ${STAGE_LABELS[c.production_stage] || c.production_stage || '— (início)'} → ${STAGE_LABELS[stage]}`]
      );
    } catch { /* tabela pode não existir antes da migration 044 */ }
  }

  let credentials: { login: string; password: string } | null = null;

  // Ao PROTOCOLAR: garante login do cliente + alerta com o nº do processo
  if (stage === 'protocolado' && c.client_id) {
    const [clRows] = await db.query('SELECT id, name, email FROM clients WHERE id = ?', [c.client_id]) as any;
    const client = clRows[0];
    const [userRows] = await db.query("SELECT id FROM users WHERE client_id = ? AND role = 'cliente' LIMIT 1", [c.client_id]) as any;

    let clientUserId: number;
    if (!userRows.length) {
      let login = client?.email || `cliente${client.id}@crm.local`;
      const [taken] = await db.query('SELECT id FROM users WHERE email = ?', [login]) as any;
      if (taken.length) login = `cliente${client.id}.${Date.now()}@crm.local`;
      const tempPass = Math.random().toString(36).slice(-4) + Math.random().toString(36).slice(-4).toUpperCase() + '@1';
      const hash = await bcrypt.hash(tempPass, 10);
      const [u] = await db.query(
        "INSERT INTO users (name, email, password, role, client_id) VALUES (?, ?, ?, 'cliente', ?)",
        [client.name, login, hash, client.id]
      ) as any;
      clientUserId = u.insertId;
      credentials = { login, password: tempPass };
    } else {
      clientUserId = userRows[0].id;
    }

    await notificationService.create({
      userId: clientUserId, clientId: client.id, caseId: Number(id),
      title: 'Seu processo foi protocolado',
      message: `O processo de nº ${finalCaseNumber} foi protocolado. Acompanhe o andamento pelo portal.`,
      notificationType: 'processo_protocolado', channel: 'sistema', scheduledAt: new Date(),
    });
  }

  // Ao mover para "CRIAÇÃO INICIAL": gera a petição inicial com a IA, lendo o
  // relato + os DOCUMENTOS anexados (Drive) do caso. Só na entrada na etapa.
  let peticao: { ok: boolean; docId?: number; message?: string } | null = null;
  if (stage === 'criacao_inicial' && c.production_stage !== 'criacao_inicial') {
    try { peticao = await buildPeticaoInicial(Number(id), req.user!.id); }
    catch (e: any) { peticao = { ok: false, message: e?.message || 'Falha ao gerar a petição' }; }
  }

  // Ao mover para "REVISÃO INICIAL": revisa a petição (checagens estruturais +
  // análise de mérito por IA) e salva o parecer nos Documentos do caso.
  let revisao: { ok: boolean; docId?: number; message?: string; resumo?: any } | null = null;
  if (stage === 'revisao_inicial' && c.production_stage !== 'revisao_inicial') {
    try { revisao = await revisarPeticaoDoCaso(Number(id), req.user!.id); }
    catch (e: any) { revisao = { ok: false, message: e?.message || 'Falha ao revisar a petição' }; }
  }

  res.json({ success: true, production_stage: stage, case_number: finalCaseNumber, credentials, peticao, revisao });
  } catch (err: any) {
    console.error('Erro no production-stage:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Erro ao mover a etapa de produção' });
  }
});

// ── GET /api/cases/:id/timeline — histórico ligado a este caso ──────────────
router.get('/:id/timeline', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT t.event_type, t.description, t.created_at, u.name AS by_name
     FROM client_timeline t LEFT JOIN users u ON u.id = t.created_by
     WHERE t.case_id = ? ORDER BY t.created_at DESC`,
    [req.params.id]
  ) as any;
  res.json(rows);
});

export default router;
