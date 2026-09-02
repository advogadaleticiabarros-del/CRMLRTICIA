import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { extrairNomeacaoDativa } from '../services/aiAssistant';

const router = Router();

const CASE_STATUS = ['nomeada', 'em_andamento', 'concluida', 'a_receber', 'paga'];
const AREAS = ['criminal', 'familia', 'civel', 'previdenciario', 'trabalhista', 'infancia', 'outro'];
const HEARING_STATUS = ['agendada', 'realizada', 'adiada', 'cancelada'];
const PAY_STATUS = ['previsto', 'recebido'];

// ── Agenda: audiência dativa × Google Calendar ───────────────────────────────
// dative_hearings tem o próprio enum de status (agendada/realizada/adiada/
// cancelada) — mapeia para o status de negócio de calendar_events
// (agendado/realizado/cancelado, migration 118) que decide a cor no Google.
// "Adiada" não vira cor própria: continua "agendado" (a nova data já reflete
// isso em hearing_date), igual à regra já adotada para calendar_events.status.
function dativeStatusToCalendarStatus(status: string): 'agendado' | 'realizado' | 'cancelado' {
  if (status === 'realizada') return 'realizado';
  if (status === 'cancelada') return 'cancelado';
  return 'agendado'; // agendada, adiada
}

/**
 * Cria/atualiza o evento da agenda da audiência dativa (para sincronizar com
 * o Google Calendar, incluindo a cor por status). Segue o mesmo padrão já
 * usado para correspondent_hearings (ver src/routes/correspondente.ts) — só
 * marca `sync_status = 'pendente'`, quem efetivamente envia pro Google é o
 * cron (`calendarSyncService.pushToGoogle`, roda a cada poucos minutos).
 */
async function syncDativeHearingToCalendar(hearingId: number, userId: number): Promise<void> {
  const [[h]] = await db.query(
    `SELECT h.*, dc.process_number, dc.assisted_name
       FROM dative_hearings h
       JOIN dative_cases dc ON dc.id = h.dative_case_id
      WHERE h.id = ?`,
    [hearingId]
  ) as any;
  if (!h) return;

  const title = `Audiência dativa — ${h.comarca || h.assisted_name || 'Estado'}`;
  const desc = `Assistido: ${h.assisted_name || '—'}. Processo: ${h.process_number || '—'}. Tipo: ${h.type || '—'}. Valor do ato: ${h.act_value}.`;
  const status = dativeStatusToCalendarStatus(h.status);

  const [ex] = await db.query('SELECT id FROM calendar_events WHERE dative_hearing_id = ?', [hearingId]) as any;
  if (ex.length) {
    await db.query(
      `UPDATE calendar_events SET title = ?, description = ?, event_type = 'audiencia',
         start_datetime = ?, end_datetime = DATE_ADD(?, INTERVAL 1 HOUR), location = ?, status = ?, sync_status = 'pendente'
       WHERE dative_hearing_id = ?`,
      [title, desc, h.hearing_date, h.hearing_date, h.comarca ?? null, status, hearingId]
    );
  } else {
    await db.query(
      `INSERT INTO calendar_events
         (user_id, title, description, event_type, start_datetime, end_datetime, location, source, sync_status, status, dative_hearing_id)
       VALUES (?, ?, ?, 'audiencia', ?, DATE_ADD(?, INTERVAL 1 HOUR), ?, 'crm', 'pendente', ?, ?)`,
      [userId, title, desc, h.hearing_date, h.hearing_date, h.comarca ?? null, status, hearingId]
    );
  }
}

// ── GET /api/dative/summary — projeção financeira do Estado ─────────────────
router.get('/summary', async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const [[totais]] = await db.query(`
    SELECT
      (SELECT COALESCE(SUM(estimated_value),0) FROM dative_cases WHERE user_id = ? AND status <> 'paga')        AS estimado_total,
      (SELECT COALESCE(SUM(act_value),0) FROM dative_hearings WHERE user_id = ? AND status = 'realizada')        AS realizado,
      (SELECT COALESCE(SUM(act_value),0) FROM dative_hearings WHERE user_id = ? AND status = 'agendada')         AS agendado,
      (SELECT COUNT(*) FROM dative_hearings WHERE user_id = ? AND status = 'realizada')                          AS audiencias_realizadas,
      (SELECT COUNT(*) FROM dative_hearings WHERE user_id = ? AND status = 'agendada' AND hearing_date >= NOW()) AS audiencias_futuras,
      (SELECT COALESCE(SUM(value),0) FROM dative_payments WHERE user_id = ? AND status = 'recebido')             AS recebido,
      (SELECT COUNT(*) FROM dative_cases WHERE user_id = ? AND status NOT IN ('concluida','a_receber','paga'))    AS demandas_ativas
  `, Array(7).fill(userId)) as any;

  const aReceber = Math.max(0, Number(totais.realizado) - Number(totais.recebido));

  const [porComarca] = await db.query(`
    SELECT comarca,
      COUNT(*) AS audiencias,
      COALESCE(SUM(CASE WHEN status='realizada' THEN act_value ELSE 0 END),0) AS valor_realizado
    FROM dative_hearings WHERE user_id = ?
    GROUP BY comarca ORDER BY valor_realizado DESC
  `, [userId]) as any;

  const [porMes] = await db.query(`
    SELECT DATE_FORMAT(hearing_date, '%Y-%m') AS mes,
      COALESCE(SUM(CASE WHEN status='realizada' THEN act_value ELSE 0 END),0) AS realizado,
      COALESCE(SUM(CASE WHEN status='agendada'  THEN act_value ELSE 0 END),0) AS agendado
    FROM dative_hearings WHERE user_id = ?
    GROUP BY mes ORDER BY mes ASC
  `, [userId]) as any;

  res.json({
    estimado_total: totais.estimado_total,
    realizado: totais.realizado,
    agendado: totais.agendado,
    recebido: totais.recebido,
    a_receber: aReceber,
    audiencias_realizadas: totais.audiencias_realizadas,
    audiencias_futuras: totais.audiencias_futuras,
    demandas_ativas: totais.demandas_ativas,
    por_comarca: porComarca,
    por_mes: porMes,
  });
});

// ── DEMANDAS ────────────────────────────────────────────────────────────────
router.get('/cases', async (req: Request, res: Response) => {
  const status = req.query.status as string;
  const where: string[] = ['user_id = ?'];
  const params: any[] = [req.user!.id];
  if (status && CASE_STATUS.includes(status)) { where.push('status = ?'); params.push(status); }

  const [rows] = await db.query(
    `SELECT id, process_number, comarca, vara, assisted_name, area, assunto, nomeacao_date, estimated_value, arbitrated_value, status, origem
     FROM dative_cases WHERE ${where.join(' AND ')} ORDER BY nomeacao_date DESC, created_at DESC`,
    params
  ) as any;
  res.json(rows);
});

router.get('/cases/:id', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT dc.*, c.name AS client_name FROM dative_cases dc
     LEFT JOIN clients c ON c.id = dc.client_id
     WHERE dc.id = ? AND dc.user_id = ?`,
    [req.params.id, req.user!.id]
  ) as any;
  if (!rows.length) { res.status(404).json({ error: 'Demanda não encontrada' }); return; }
  const [hearings] = await db.query(
    'SELECT id, hearing_date, comarca, type, act_value, status FROM dative_hearings WHERE dative_case_id = ? ORDER BY hearing_date DESC',
    [req.params.id]
  ) as any;
  const [relatos] = await db.query(
    `SELECT n.id, n.text, n.created_at, u.name AS user_name
       FROM dative_case_notes n LEFT JOIN users u ON u.id = n.user_id
      WHERE n.dative_case_id = ? ORDER BY n.created_at DESC`,
    [req.params.id]
  ) as any;
  res.json({ ...rows[0], hearings, relatos });
});

// ── POST /api/dative/cases/:id/extrair-ia — preenche juízo/decisão/parte a
// partir da movimentação já monitorada, pra demandas que não passaram pela
// detecção automática (cadastradas manualmente antes dela existir, ou
// descobertas antes de haver movimentação suficiente). Só preenche campos
// que ainda estão vazios — nunca sobrescreve o que já foi digitado à mão.
router.post('/cases/:id/extrair-ia', async (req: Request, res: Response) => {
  const [rows] = await db.query('SELECT * FROM dative_cases WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]) as any;
  if (!rows.length) { res.status(404).json({ error: 'Demanda não encontrada' }); return; }
  const dc = rows[0];
  if (!dc.process_number) { res.status(400).json({ error: 'Esta demanda não tem número de processo cadastrado' }); return; }

  const digits = String(dc.process_number).replace(/\D/g, '');
  const [[proc]] = await db.query(
    'SELECT id FROM legal_processes WHERE process_number = ? OR REPLACE(REPLACE(REPLACE(process_number,"-",""),".",""),"/","") = ? LIMIT 1',
    [dc.process_number, digits]
  ) as any;
  if (!proc) { res.status(404).json({ error: 'Processo não encontrado no monitoramento — sem movimentação pra extrair' }); return; }

  const [movs] = await db.query(
    'SELECT title, description FROM process_movements WHERE process_id = ? ORDER BY movement_date DESC LIMIT 20',
    [proc.id]
  ) as any;
  const texto = movs.map((m: any) => `${m.title || ''}\n${m.description || ''}`).join('\n\n').trim();
  if (!texto) { res.status(400).json({ error: 'Processo monitorado ainda não tem movimentação registrada' }); return; }

  const ai = await extrairNomeacaoDativa(texto);
  if (!ai.ok || !ai.extraction) { res.status(502).json({ error: ai.message || 'IA indisponível — tente novamente em instantes' }); return; }
  const ext = ai.extraction;

  const fields: string[] = []; const params: any[] = [];
  const fillIfEmpty = (col: string, current: any, val: string) => {
    if (!current && val) { fields.push(`${col} = ?`); params.push(val); }
  };
  fillIfEmpty('juizo', dc.juizo, ext.juizo);
  fillIfEmpty('vara', dc.vara, ext.vara);
  fillIfEmpty('decisao_id', dc.decisao_id, ext.decisao_id);
  fillIfEmpty('qualificacao_parte', dc.qualificacao_parte, ext.qualificacao_parte);
  fillIfEmpty('assunto', dc.assunto, ext.assunto);
  if (!dc.comarca && ext.comarca) { fields.push('comarca = ?'); params.push(ext.comarca); }

  if (!fields.length) { res.json({ ...dc, extraido: false, message: 'Nada novo encontrado na movimentação (ou os campos já estavam preenchidos)' }); return; }
  params.push(req.params.id);
  await db.query(`UPDATE dative_cases SET ${fields.join(', ')} WHERE id = ?`, params);
  const [[atualizado]] = await db.query('SELECT * FROM dative_cases WHERE id = ?', [req.params.id]) as any;
  res.json({ ...atualizado, extraido: true });
});

// ── POST /api/dative/cases/:id/relatos — registra uma atualização (linha do tempo) ─
router.post('/cases/:id/relatos', async (req: Request, res: Response) => {
  const text = String(req.body?.text || '').trim();
  if (!text) { res.status(400).json({ error: 'Escreva o relato' }); return; }
  const [dc] = await db.query('SELECT id FROM dative_cases WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]) as any;
  if (!dc.length) { res.status(404).json({ error: 'Demanda não encontrada' }); return; }
  await db.query(
    'INSERT INTO dative_case_notes (dative_case_id, user_id, text) VALUES (?, ?, ?)',
    [req.params.id, req.user!.id, text.slice(0, 4000)]
  );
  res.status(201).json({ success: true });
});

// ── POST /api/dative/cases/:id/mover-esteira — cria o caso na esteira de produção ─
// A demanda dativa já exige um cliente vinculado (client_id) desde o cadastro —
// aproveita esse mesmo cliente, não cria outro. Idempotente: se já tem case_id,
// não duplica, só devolve o que já existe.
router.post('/cases/:id/mover-esteira', async (req: Request, res: Response) => {
  const [rows] = await db.query('SELECT * FROM dative_cases WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]) as any;
  if (!rows.length) { res.status(404).json({ error: 'Demanda não encontrada' }); return; }
  const dc = rows[0];
  if (dc.case_id) { res.json({ success: true, case_id: dc.case_id, ja_existia: true }); return; }
  if (!dc.client_id) { res.status(400).json({ error: 'Esta demanda não tem cliente/assistido vinculado — edite e informe o assistido antes' }); return; }

  // Área do dativo (criminal/infância) não tem par exato no caso — cai em "outro".
  const CASE_AREAS = ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro'];
  const legalArea = CASE_AREAS.includes(dc.area) ? dc.area : 'outro';
  const title = dc.assunto || dc.assisted_name || `Dativo — ${dc.comarca}`;
  const labels = JSON.stringify(['Dativo']);

  const [cr] = await db.query(
    `INSERT INTO cases (user_id, client_id, title, case_number, legal_area, status,
                        production_stage, production_started_at, production_labels, description)
     VALUES (?, ?, ?, ?, ?, 'ativo', 'em_analise', NOW(), ?, ?)`,
    [req.user!.id, dc.client_id, title, dc.process_number || null, legalArea, labels, dc.notes || null]
  ) as any;
  await db.query('UPDATE dative_cases SET case_id = ? WHERE id = ?', [cr.insertId, req.params.id]);
  await db.query(
    'INSERT INTO dative_case_notes (dative_case_id, user_id, text) VALUES (?, ?, ?)',
    [req.params.id, req.user!.id, 'Demanda movida para a esteira de produção.']
  ).catch(() => {});

  res.status(201).json({ success: true, case_id: cr.insertId, ja_existia: false });
});

router.post('/cases', async (req: Request, res: Response) => {
  const { process_number, comarca, vara, assisted_name, area, assunto, nomeacao_date, estimated_value, notes,
          client_id, client_cpf, client_phone, client_email } = req.body;
  if (!comarca || !String(comarca).trim()) { res.status(400).json({ error: 'A comarca é obrigatória' }); return; }
  if (!client_id && !(assisted_name && String(assisted_name).trim())) {
    res.status(400).json({ error: 'Informe o cliente (assistido): selecione um existente ou preencha o nome' });
    return;
  }

  // Cria ou vincula a ficha do cliente, marcando a etiqueta DATIVO
  let clientId: number | null = null;
  if (client_id) {
    const [cl] = await db.query('SELECT id FROM clients WHERE id = ?', [client_id]) as any;
    if (!cl.length) { res.status(400).json({ error: 'Cliente vinculado não encontrado' }); return; }
    await db.query('UPDATE clients SET is_dative = 1 WHERE id = ?', [client_id]);
    clientId = Number(client_id);
  } else {
    const [newClient] = await db.query(
      `INSERT INTO clients (name, tipo, cpf_cnpj, phone, email, status, is_dative, created_by, notes)
       VALUES (?, 'PF', ?, ?, ?, 'ativo', 1, ?, ?)`,
      [assisted_name.trim(), client_cpf ?? null, client_phone ?? null, client_email ?? null, req.user!.id,
       `Cliente cadastrado via demanda dativa — ${comarca.trim()}`]
    ) as any;
    clientId = newClient.insertId;
  }

  const [result] = await db.query(
    `INSERT INTO dative_cases (user_id, client_id, process_number, comarca, vara, assisted_name, area, assunto, nomeacao_date, estimated_value, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user!.id, clientId, process_number ?? null, comarca.trim(), vara ?? null, assisted_name ?? null,
     AREAS.includes(area) ? area : 'outro', (assunto && String(assunto).trim()) ? String(assunto).trim() : null,
     nomeacao_date || null, Number(estimated_value) || 0, notes ?? null]
  ) as any;
  const [rows] = await db.query('SELECT * FROM dative_cases WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

router.put('/cases/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT id FROM dative_cases WHERE id = ? AND user_id = ?', [id, req.user!.id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Demanda não encontrada' }); return; }

  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };
  setIf('process_number', req.body.process_number);
  setIf('comarca', req.body.comarca?.trim?.());
  setIf('vara', req.body.vara);
  setIf('juizo', req.body.juizo);
  setIf('decisao_id', req.body.decisao_id);
  setIf('qualificacao_parte', req.body.qualificacao_parte);
  setIf('assisted_name', req.body.assisted_name);
  setIf('area', req.body.area, AREAS.includes(req.body.area));
  setIf('assunto', req.body.assunto !== undefined ? (String(req.body.assunto).trim() || null) : undefined);
  setIf('nomeacao_date', req.body.nomeacao_date);
  setIf('estimated_value', req.body.estimated_value !== undefined ? Number(req.body.estimated_value) : undefined);
  setIf('status', req.body.status, CASE_STATUS.includes(req.body.status));
  setIf('notes', req.body.notes);

  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido para atualizar' }); return; }
  params.push(id);
  await db.query(`UPDATE dative_cases SET ${fields.join(', ')} WHERE id = ?`, params);
  const [rows] = await db.query('SELECT * FROM dative_cases WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

// ── AUDIÊNCIAS ──────────────────────────────────────────────────────────────
router.get('/hearings', async (req: Request, res: Response) => {
  const status = req.query.status as string;
  const where: string[] = ['h.user_id = ?'];
  const params: any[] = [req.user!.id];
  if (status && HEARING_STATUS.includes(status)) { where.push('h.status = ?'); params.push(status); }

  const [rows] = await db.query(
    `SELECT h.id, h.dative_case_id, h.hearing_date, h.comarca, h.type, h.act_value, h.status, h.notes,
            dc.process_number, dc.assisted_name
     FROM dative_hearings h
     JOIN dative_cases dc ON dc.id = h.dative_case_id
     WHERE ${where.join(' AND ')} ORDER BY h.hearing_date DESC`,
    params
  ) as any;
  res.json(rows);
});

router.post('/hearings', async (req: Request, res: Response) => {
  const { dative_case_id, hearing_date, comarca, type, act_value, status } = req.body;
  if (!dative_case_id) { res.status(400).json({ error: 'dative_case_id é obrigatório' }); return; }
  if (!hearing_date) { res.status(400).json({ error: 'A data da audiência é obrigatória' }); return; }

  const [c] = await db.query('SELECT comarca FROM dative_cases WHERE id = ? AND user_id = ?', [dative_case_id, req.user!.id]) as any;
  if (!c.length) { res.status(404).json({ error: 'Demanda não encontrada' }); return; }

  const [result] = await db.query(
    `INSERT INTO dative_hearings (dative_case_id, user_id, hearing_date, comarca, type, act_value, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [dative_case_id, req.user!.id, hearing_date, comarca || c[0].comarca, type ?? null,
     Number(act_value) || 0, HEARING_STATUS.includes(status) ? status : 'agendada']
  ) as any;
  await syncDativeHearingToCalendar(result.insertId, req.user!.id).catch(() => {});
  const [rows] = await db.query('SELECT * FROM dative_hearings WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

router.put('/hearings/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT id FROM dative_hearings WHERE id = ? AND user_id = ?', [id, req.user!.id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Audiencia nao encontrada' }); return; }

  if (req.body.dative_case_id !== undefined && req.body.dative_case_id !== null && req.body.dative_case_id !== '') {
    const [c] = await db.query('SELECT id FROM dative_cases WHERE id = ? AND user_id = ?', [req.body.dative_case_id, req.user!.id]) as any;
    if (!c.length) { res.status(400).json({ error: 'Demanda vinculada nao encontrada' }); return; }
  }

  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };
  setIf('dative_case_id', req.body.dative_case_id ? Number(req.body.dative_case_id) : undefined);
  setIf('hearing_date', req.body.hearing_date);
  setIf('comarca', req.body.comarca);
  setIf('type', req.body.type);
  setIf('act_value', req.body.act_value !== undefined ? Number(req.body.act_value) : undefined, req.body.act_value === undefined || !Number.isNaN(Number(req.body.act_value)));
  setIf('status', req.body.status, HEARING_STATUS.includes(req.body.status));
  setIf('notes', req.body.notes);

  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo valido para atualizar' }); return; }
  params.push(id, req.user!.id);
  await db.query(`UPDATE dative_hearings SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, params);
  await syncDativeHearingToCalendar(Number(id), req.user!.id).catch(() => {});
  const [rows] = await db.query('SELECT * FROM dative_hearings WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

router.patch('/hearings/:id/status', async (req: Request, res: Response) => {
  const { status } = req.body;
  if (!HEARING_STATUS.includes(status)) {
    res.status(400).json({ error: `status deve ser: ${HEARING_STATUS.join(', ')}` }); return;
  }
  const [result] = await db.query(
    'UPDATE dative_hearings SET status = ? WHERE id = ? AND user_id = ?',
    [status, req.params.id, req.user!.id]
  ) as any;
  if (!result.affectedRows) { res.status(404).json({ error: 'Audiência não encontrada' }); return; }
  await syncDativeHearingToCalendar(Number(req.params.id), req.user!.id).catch(() => {});
  res.json({ success: true, status });
});

// Edita uma audiência já lançada — o valor do ato pode vir a mais ou a menos
// do que o estimado, e datas/tipo podem precisar de correção.
router.put('/hearings/:id', async (req: Request, res: Response) => {
  const [existing] = await db.query('SELECT id FROM dative_hearings WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Audiência não encontrada' }); return; }

  const fields: string[] = []; const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => { if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); } };
  setIf('hearing_date', req.body.hearing_date);
  setIf('comarca', req.body.comarca);
  setIf('type', req.body.type);
  setIf('act_value', req.body.act_value !== undefined ? Number(req.body.act_value) : undefined);
  setIf('status', req.body.status, HEARING_STATUS.includes(req.body.status));

  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido' }); return; }
  params.push(req.params.id);
  await db.query(`UPDATE dative_hearings SET ${fields.join(', ')} WHERE id = ?`, params);
  await syncDativeHearingToCalendar(Number(req.params.id), req.user!.id).catch(() => {});
  const [rows] = await db.query('SELECT * FROM dative_hearings WHERE id = ?', [req.params.id]) as any;
  res.json(rows[0]);
});

// ── RECEBIMENTOS DO ESTADO ──────────────────────────────────────────────────
// ── PATCH /api/dative/cases/:id/receber — o Estado pagou a nomeação ─────────
// Cria o recebimento (hoje, valor informado ou o estimado) e marca a demanda
// como paga — usado pela baixa direta no A Receber do Financeiro.
router.patch('/cases/:id/receber', async (req: Request, res: Response) => {
  const [[c]] = await db.query(
    'SELECT id, estimated_value, status FROM dative_cases WHERE id = ? AND user_id = ?',
    [req.params.id, req.user!.id]
  ) as any;
  if (!c) { res.status(404).json({ error: 'Demanda não encontrada' }); return; }
  const valor = Number(req.body?.valor) > 0 ? Number(req.body.valor) : Number(c.estimated_value) || 0;
  if (valor <= 0) { res.status(400).json({ error: 'Informe o valor recebido' }); return; }
  await db.query(
    `INSERT INTO dative_payments (user_id, dative_case_id, reference, value, received_date, status)
     VALUES (?, ?, 'Pagamento da nomeação', ?, CURDATE(), 'recebido')`,
    [req.user!.id, c.id, valor]
  );
  await db.query("UPDATE dative_cases SET status = 'paga' WHERE id = ?", [c.id]);
  res.json({ success: true, valor });
});

router.get('/payments', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT p.id, p.dative_case_id, p.reference, p.value, p.expected_date, p.received_date, p.status, p.notes, dc.comarca
     FROM dative_payments p
     LEFT JOIN dative_cases dc ON dc.id = p.dative_case_id
     WHERE p.user_id = ? ORDER BY COALESCE(p.received_date, p.expected_date) DESC`,
    [req.user!.id]
  ) as any;
  res.json(rows);
});

router.post('/payments', async (req: Request, res: Response) => {
  const { dative_case_id, reference, value, expected_date, received_date, status } = req.body;
  if (!value) { res.status(400).json({ error: 'O valor é obrigatório' }); return; }

  const finalStatus = PAY_STATUS.includes(status) ? status : (received_date ? 'recebido' : 'previsto');
  const [result] = await db.query(
    `INSERT INTO dative_payments (user_id, dative_case_id, reference, value, expected_date, received_date, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.user!.id, dative_case_id ?? null, reference ?? null, Number(value),
     expected_date || null, received_date || null, finalStatus]
  ) as any;
  const [rows] = await db.query('SELECT * FROM dative_payments WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

router.put('/payments/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT id FROM dative_payments WHERE id = ? AND user_id = ?', [id, req.user!.id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Recebimento nao encontrado' }); return; }

  if (req.body.dative_case_id !== undefined && req.body.dative_case_id !== null && req.body.dative_case_id !== '') {
    const [c] = await db.query('SELECT id FROM dative_cases WHERE id = ? AND user_id = ?', [req.body.dative_case_id, req.user!.id]) as any;
    if (!c.length) { res.status(400).json({ error: 'Demanda vinculada nao encontrada' }); return; }
  }

  const fields: string[] = [];
  const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => {
    if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); }
  };
  if (req.body.dative_case_id !== undefined) { fields.push('dative_case_id = ?'); params.push(req.body.dative_case_id ? Number(req.body.dative_case_id) : null); }
  setIf('reference', req.body.reference);
  setIf('value', req.body.value !== undefined ? Number(req.body.value) : undefined, req.body.value === undefined || !Number.isNaN(Number(req.body.value)));
  setIf('expected_date', req.body.expected_date || null);
  setIf('received_date', req.body.received_date || null);
  setIf('status', req.body.status, PAY_STATUS.includes(req.body.status));
  setIf('notes', req.body.notes);

  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo valido para atualizar' }); return; }
  params.push(id, req.user!.id);
  await db.query(`UPDATE dative_payments SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, params);
  const [rows] = await db.query('SELECT * FROM dative_payments WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

router.patch('/payments/:id/receive', async (req: Request, res: Response) => {
  const [result] = await db.query(
    "UPDATE dative_payments SET status = 'recebido', received_date = COALESCE(received_date, CURDATE()) WHERE id = ? AND user_id = ?",
    [req.params.id, req.user!.id]
  ) as any;
  if (!result.affectedRows) { res.status(404).json({ error: 'Recebimento não encontrado' }); return; }
  res.json({ success: true });
});

// Edita um recebimento já lançado (valor/datas/status).
router.put('/payments/:id', async (req: Request, res: Response) => {
  const [existing] = await db.query('SELECT id FROM dative_payments WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Recebimento não encontrado' }); return; }

  const fields: string[] = []; const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => { if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); } };
  setIf('reference', req.body.reference);
  setIf('value', req.body.value !== undefined ? Number(req.body.value) : undefined);
  setIf('expected_date', req.body.expected_date);
  setIf('received_date', req.body.received_date);
  setIf('status', req.body.status, PAY_STATUS.includes(req.body.status));

  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido' }); return; }
  params.push(req.params.id);
  await db.query(`UPDATE dative_payments SET ${fields.join(', ')} WHERE id = ?`, params);
  const [rows] = await db.query('SELECT * FROM dative_payments WHERE id = ?', [req.params.id]) as any;
  res.json(rows[0]);
});

export default router;
