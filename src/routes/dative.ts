import { Router, Request, Response } from 'express';
import { db } from '../config/database';

const router = Router();

const CASE_STATUS = ['nomeada', 'em_andamento', 'concluida', 'paga'];
const AREAS = ['criminal', 'familia', 'civel', 'previdenciario', 'trabalhista', 'infancia', 'outro'];
const HEARING_STATUS = ['agendada', 'realizada', 'adiada', 'cancelada'];
const PAY_STATUS = ['previsto', 'recebido'];

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
      (SELECT COUNT(*) FROM dative_cases WHERE user_id = ? AND status NOT IN ('concluida','paga'))               AS demandas_ativas
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
    `SELECT id, process_number, comarca, vara, assisted_name, area, nomeacao_date, estimated_value, status
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
  res.json({ ...rows[0], hearings });
});

router.post('/cases', async (req: Request, res: Response) => {
  const { process_number, comarca, vara, assisted_name, area, nomeacao_date, estimated_value, notes,
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
    `INSERT INTO dative_cases (user_id, client_id, process_number, comarca, vara, assisted_name, area, nomeacao_date, estimated_value, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user!.id, clientId, process_number ?? null, comarca.trim(), vara ?? null, assisted_name ?? null,
     AREAS.includes(area) ? area : 'outro', nomeacao_date || null, Number(estimated_value) || 0, notes ?? null]
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
  setIf('assisted_name', req.body.assisted_name);
  setIf('area', req.body.area, AREAS.includes(req.body.area));
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
    `SELECT h.id, h.hearing_date, h.comarca, h.type, h.act_value, h.status,
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
  const [rows] = await db.query('SELECT * FROM dative_hearings WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
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
  res.json({ success: true, status });
});

// ── RECEBIMENTOS DO ESTADO ──────────────────────────────────────────────────
router.get('/payments', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT p.id, p.reference, p.value, p.expected_date, p.received_date, p.status, dc.comarca
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

router.patch('/payments/:id/receive', async (req: Request, res: Response) => {
  const [result] = await db.query(
    "UPDATE dative_payments SET status = 'recebido', received_date = COALESCE(received_date, CURDATE()) WHERE id = ? AND user_id = ?",
    [req.params.id, req.user!.id]
  ) as any;
  if (!result.affectedRows) { res.status(404).json({ error: 'Recebimento não encontrado' }); return; }
  res.json({ success: true });
});

export default router;
