import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../config/database';
import { logActivity } from '../services/JourneyService';
import { sendProposalLink, isEmailConfigured } from '../services/EmailService';

const router = Router();

const STATUSES = ['rascunho', 'enviada', 'em_negociacao', 'aceita', 'recusada'];
const PROP_STATUS_PT: Record<string, string> = {
  rascunho: 'Rascunho', enviada: 'Enviada', em_negociacao: 'Em negociação', aceita: 'Aceita', recusada: 'Recusada',
};

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}
const toDateStr = (d: Date) => d.toISOString().split('T')[0];

// ── GET /api/propostas — lista com filtros e paginação ──────────────────────
router.get('/', async (req: Request, res: Response) => {
  const status   = req.query.status as string;
  const clientId = req.query.client_id as string;
  const page     = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit    = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset   = (page - 1) * limit;

  const where: string[] = ['p.user_id = ?'];
  const params: any[] = [req.user!.id];
  if (status && STATUSES.includes(status)) { where.push('p.status = ?'); params.push(status); }
  if (clientId) { where.push('p.client_id = ?'); params.push(clientId); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM propostas p ${whereSql}`, params) as any;

  const [rows] = await db.query(
    `SELECT p.id, p.title, p.valor, p.status, p.validade, p.created_at, p.tipo_causa,
            COALESCE(c.name, p.contact_name) AS client_name
     FROM propostas p
     LEFT JOIN clients c ON c.id = p.client_id
     ${whereSql}
     ORDER BY p.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as any;

  res.json({ data: rows, total, page, limit, pages: Math.ceil(total / limit) });
});

// ── GET /api/propostas/:id — detalhe com parcelas ───────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT p.*, c.name AS client_name FROM propostas p
     LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = ?`,
    [req.params.id]
  ) as any;
  if (!rows.length) {
    res.status(404).json({ error: 'Proposta não encontrada' });
    return;
  }

  const [installments] = await db.query(
    'SELECT id, numero, valor, due_date, status, paid_at FROM installments WHERE proposta_id = ? ORDER BY numero ASC',
    [req.params.id]
  ) as any;

  res.json({ ...rows[0], installments });
});

// ── POST /api/propostas — criar ─────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { client_id, case_id, lead_id, title, valor, validade, description, status,
          legal_area, tipo_causa, contact_name, cpf, phone, email, dependentes, honorarios, observacoes } = req.body;

  if (!client_id && !lead_id) { res.status(400).json({ error: 'Informe o cliente ou o lead' }); return; }
  const finalTitle = (title && String(title).trim()) || `Proposta — ${contact_name || tipo_causa || 'cliente'}`;

  const publicToken = crypto.randomUUID();
  const [result] = await db.query(
    `INSERT INTO propostas
       (user_id, client_id, case_id, lead_id, title, valor, status, validade, description,
        legal_area, tipo_causa, contact_name, cpf, phone, email, dependentes, honorarios, observacoes, public_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user!.id, client_id ?? null, case_id ?? null, lead_id ?? null,
      finalTitle, Number(valor) || 0, STATUSES.includes(status) ? status : 'rascunho',
      validade || null, description ?? null,
      legal_area ?? null, tipo_causa ?? null, contact_name ?? null, cpf ?? null, phone ?? null, email ?? null,
      dependentes ? JSON.stringify(dependentes) : null, honorarios ? JSON.stringify(honorarios) : null, observacoes ?? null,
      publicToken,
    ]
  ) as any;

  const [rows] = await db.query('SELECT * FROM propostas WHERE id = ?', [result.insertId]) as any;

  await logActivity({
    leadId: lead_id ?? null, clientId: client_id, caseId: case_id ?? null,
    actorId: req.user!.id, actorName: req.user!.name,
    eventType: 'proposal_created', title: 'Proposta gerada',
    description: `${title.trim()} — valor ${Number(valor) || 0}`,
  });

  res.status(201).json(rows[0]);
});

// ── PUT /api/propostas/:id ──────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT id FROM propostas WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Proposta não encontrada' }); return; }

  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };
  setIf('title', req.body.title?.trim?.());
  setIf('valor', req.body.valor !== undefined ? Number(req.body.valor) : undefined);
  setIf('validade', req.body.validade);
  setIf('description', req.body.description);
  setIf('case_id', req.body.case_id);
  setIf('status', req.body.status, STATUSES.includes(req.body.status));
  setIf('legal_area', req.body.legal_area);
  setIf('tipo_causa', req.body.tipo_causa);
  setIf('contact_name', req.body.contact_name);
  setIf('cpf', req.body.cpf);
  setIf('phone', req.body.phone);
  setIf('email', req.body.email);
  setIf('observacoes', req.body.observacoes);
  if (req.body.dependentes !== undefined) { fields.push('dependentes = ?'); params.push(req.body.dependentes ? JSON.stringify(req.body.dependentes) : null); }
  if (req.body.honorarios !== undefined) { fields.push('honorarios = ?'); params.push(req.body.honorarios ? JSON.stringify(req.body.honorarios) : null); }

  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido para atualizar' }); return; }
  params.push(id);

  const [before] = await db.query('SELECT * FROM propostas WHERE id = ?', [id]) as any;
  await db.query(`UPDATE propostas SET ${fields.join(', ')} WHERE id = ?`, params);

  const [rows] = await db.query('SELECT * FROM propostas WHERE id = ?', [id]) as any;
  const after = rows[0];

  await logActivity({
    leadId: after.lead_id, clientId: after.client_id, caseId: after.case_id,
    actorId: req.user!.id, actorName: req.user!.name,
    eventType: 'proposal_edited', title: 'Proposta editada',
    description: `${after.title} — valor ${after.valor}`,
  });

  res.json(after);
});

// ── PATCH /api/propostas/:id/status — enviar, negociar, recusar ─────────────
router.patch('/:id/status', async (req: Request, res: Response) => {
  const { status } = req.body;
  if (!STATUSES.includes(status)) {
    res.status(400).json({ error: `status deve ser um de: ${STATUSES.join(', ')}` });
    return;
  }
  if (status === 'aceita') {
    res.status(400).json({ error: 'Para aceitar, use POST /api/propostas/:id/accept (gera as parcelas)' });
    return;
  }
  const [pRows] = await db.query('SELECT lead_id, client_id, case_id, status FROM propostas WHERE id = ?', [req.params.id]) as any;
  if (!pRows.length) { res.status(404).json({ error: 'Proposta não encontrada' }); return; }
  const p = pRows[0];
  await db.query('UPDATE propostas SET status = ? WHERE id = ?', [status, req.params.id]);

  await logActivity({
    leadId: p.lead_id, clientId: p.client_id, caseId: p.case_id,
    actorId: req.user!.id, actorName: req.user!.name,
    eventType: 'proposal_status', title: 'Status da proposta atualizado',
    oldValue: PROP_STATUS_PT[p.status] || p.status, newValue: PROP_STATUS_PT[status] || status,
  });

  res.json({ success: true, id: Number(req.params.id), status });
});

// ── POST /api/propostas/:id/accept — aceitar e gerar parcelas ───────────────
router.post('/:id/accept', async (req: Request, res: Response) => {
  const { id } = req.params;
  const installmentsCount = Math.max(1, Math.min(60, parseInt(req.body.installments_count) || 1));
  const firstDueDate = req.body.first_due_date ? new Date(req.body.first_due_date) : new Date();

  const [rows] = await db.query('SELECT * FROM propostas WHERE id = ?', [id]) as any;
  if (!rows.length) { res.status(404).json({ error: 'Proposta não encontrada' }); return; }
  const proposta = rows[0];

  if (proposta.status === 'aceita') {
    res.status(409).json({ error: 'Proposta já foi aceita' });
    return;
  }

  const total = Number(proposta.valor);
  const base = Math.floor((total / installmentsCount) * 100) / 100;
  const last = Math.round((total - base * (installmentsCount - 1)) * 100) / 100;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("UPDATE propostas SET status = 'aceita' WHERE id = ?", [id]);

    // Cria o caso automaticamente quando a proposta ainda não tem um (fecha o
    // elo comercial: proposta aceita → caso → parcelas).
    let caseId = proposta.case_id;
    if (!caseId && proposta.client_id) {
      const [cr] = await conn.query(
        `INSERT INTO cases (user_id, client_id, title, legal_area, status)
         VALUES (?, ?, ?, 'outro', 'ativo')`,
        [req.user!.id, proposta.client_id, proposta.title || 'Caso (proposta aceita)']
      ) as any;
      caseId = cr.insertId;
      await conn.query('UPDATE propostas SET case_id = ? WHERE id = ?', [caseId, id]);
    }

    for (let i = 0; i < installmentsCount; i++) {
      const valor = i === installmentsCount - 1 ? last : base;
      const dueDate = toDateStr(addMonths(firstDueDate, i));
      await conn.query(
        `INSERT INTO installments (user_id, client_id, proposta_id, case_id, numero, valor, due_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pendente')`,
        [req.user!.id, proposta.client_id, proposta.id, caseId, i + 1, valor, dueDate]
      );
    }
    await conn.commit();
    proposta.case_id = caseId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await logActivity({
    leadId: proposta.lead_id, clientId: proposta.client_id, caseId: proposta.case_id,
    actorId: req.user!.id, actorName: req.user!.name,
    eventType: 'proposal_accepted', title: 'Proposta ACEITA',
    description: `${proposta.title} — ${installmentsCount}x · gerou as parcelas`,
    oldValue: PROP_STATUS_PT[proposta.status] || proposta.status, newValue: 'Aceita',
  });

  const [installments] = await db.query(
    'SELECT id, numero, valor, due_date, status FROM installments WHERE proposta_id = ? ORDER BY numero ASC',
    [id]
  ) as any;

  res.json({ success: true, status: 'aceita', installments });
});

// ── POST /api/propostas/:id/share — garante o token público e devolve o link ─
router.post('/:id/share', async (req: Request, res: Response) => {
  const [rows] = await db.query('SELECT public_token FROM propostas WHERE id = ?', [req.params.id]) as any;
  if (!rows.length) { res.status(404).json({ error: 'Proposta não encontrada' }); return; }
  let token = rows[0].public_token;
  if (!token) {
    token = crypto.randomUUID();
    await db.query('UPDATE propostas SET public_token = ? WHERE id = ?', [token, req.params.id]);
  }
  res.json({ token });
});

// ── POST /api/propostas/:id/send-email — envia a proposta por e-mail ao cliente ─
router.post('/:id/send-email', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT p.public_token, p.title, COALESCE(p.email, cl.email) AS email,
            COALESCE(p.contact_name, cl.name) AS name
     FROM propostas p LEFT JOIN clients cl ON cl.id = p.client_id WHERE p.id = ?`,
    [req.params.id]
  ) as any;
  if (!rows.length) { res.status(404).json({ error: 'Proposta não encontrada' }); return; }
  const p = rows[0];

  const to = (req.body?.email || p.email || '').trim();
  if (!to) { res.status(400).json({ error: 'A proposta não tem e-mail do cliente. Informe um e-mail.' }); return; }
  if (!isEmailConfigured()) { res.status(503).json({ error: 'Envio de e-mail ainda não configurado no servidor (SMTP).' }); return; }

  let token = p.public_token;
  if (!token) {
    token = crypto.randomUUID();
    await db.query('UPDATE propostas SET public_token = ? WHERE id = ?', [token, req.params.id]);
  }
  const url = `https://crm.advogadaleticiabarros.com.br/proposta.html?t=${token}`;
  const r = await sendProposalLink(to, p.name, url, p.title);
  if (!r.ok) { res.status(400).json({ error: r.error || 'Falha ao enviar e-mail' }); return; }
  res.json({ success: true, to });
});

export default router;
