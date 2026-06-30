import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { logTimeline } from '../services/TimelineService';

const router = Router();

const AREAS = ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro'];

// ── GET /api/partners — lista de parceiros ──────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  const [rows] = await db.query('SELECT * FROM partners ORDER BY active DESC, name ASC') as any;
  res.json(rows);
});

// ── POST /api/partners — cadastra um parceiro ───────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) { res.status(400).json({ error: 'O nome do parceiro é obrigatório' }); return; }
  const [r] = await db.query(
    `INSERT INTO partners (name, success_fee_percent, partner_split_percent, sucumbencia_split_percent, entry_value_single, entry_value_double, entry_split, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [String(b.name).trim(), Number(b.success_fee_percent) || 30, Number(b.partner_split_percent) || 50,
     Number(b.sucumbencia_split_percent) || 50, Number(b.entry_value_single) || 100, Number(b.entry_value_double) || 130,
     b.entry_split ? 1 : 0, b.notes ?? null]
  ) as any;
  res.status(201).json({ id: r.insertId });
});

// ── PUT /api/partners/:id ───────────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const b = req.body || {};
  const fields: string[] = []; const params: any[] = [];
  const setIf = (col: string, val: any) => { if (val !== undefined) { fields.push(`${col} = ?`); params.push(val); } };
  setIf('name', b.name?.trim?.());
  setIf('success_fee_percent', b.success_fee_percent !== undefined ? Number(b.success_fee_percent) : undefined);
  setIf('partner_split_percent', b.partner_split_percent !== undefined ? Number(b.partner_split_percent) : undefined);
  setIf('sucumbencia_split_percent', b.sucumbencia_split_percent !== undefined ? Number(b.sucumbencia_split_percent) : undefined);
  setIf('entry_value_single', b.entry_value_single !== undefined ? Number(b.entry_value_single) : undefined);
  setIf('entry_value_double', b.entry_value_double !== undefined ? Number(b.entry_value_double) : undefined);
  setIf('entry_split', b.entry_split !== undefined ? (b.entry_split ? 1 : 0) : undefined);
  setIf('notes', b.notes);
  setIf('active', b.active !== undefined ? (b.active ? 1 : 0) : undefined);
  if (!fields.length) { res.status(400).json({ error: 'Nada para atualizar' }); return; }
  params.push(req.params.id);
  await db.query(`UPDATE partners SET ${fields.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

/** Valor da entrada conforme o nº de protocolos (1 → single, 2 → double, +2 → double + single*(n-2)). */
function entradaValor(p: any, n: number): number {
  const single = Number(p.entry_value_single) || 100;
  const double = Number(p.entry_value_double) || 130;
  if (n <= 1) return single;
  if (n === 2) return double;
  return double + (n - 2) * single;
}

// ── POST /api/partners/:id/cases — registra cliente + processos da parceria ──
// Cria o cliente (sem passar pelo lead), os casos já na esteira de produção
// (mesmo SLA) e a entrada por protocolo no financeiro.
router.post('/:id/cases', async (req: Request, res: Response) => {
  const b = req.body || {};
  const [[partner]] = await db.query('SELECT * FROM partners WHERE id = ?', [req.params.id]) as any;
  if (!partner) { res.status(404).json({ error: 'Parceiro não encontrado' }); return; }

  const nome = String(b.client_name || '').trim();
  if (!nome) { res.status(400).json({ error: 'Nome do cliente é obrigatório' }); return; }
  const area = AREAS.includes(b.legal_area) ? b.legal_area : 'outro';
  const processos: any[] = Array.isArray(b.processos) && b.processos.length ? b.processos : [{ title: nome }];

  // Cliente — dedup por nome (ou cria)
  let clientId: number;
  const [found] = await db.query('SELECT id FROM clients WHERE LOWER(name) = LOWER(?) LIMIT 1', [nome]) as any;
  if (found.length) {
    clientId = found[0].id;
    if (b.cpf || b.email || b.phone) {
      await db.query('UPDATE clients SET cpf_cnpj = COALESCE(?, cpf_cnpj), email = COALESCE(?, email), phone = COALESCE(?, phone) WHERE id = ?',
        [b.cpf || null, b.email || null, b.phone || null, clientId]);
    }
  } else {
    const [ins] = await db.query(
      "INSERT INTO clients (name, tipo, cpf_cnpj, email, phone, status, notes, created_by) VALUES (?, 'PF', ?, ?, ?, 'ativo', ?, ?)",
      [nome, b.cpf || null, b.email || null, b.phone || null, `Cliente indicado pela parceria ${partner.name}.`, req.user!.id]
    ) as any;
    clientId = ins.insertId;
  }

  // Casos — um por processo, já na esteira de produção (SLA conta a partir de agora)
  const labels = JSON.stringify([`Parceria: ${partner.name}`]);
  const caseIds: number[] = [];
  for (const proc of processos) {
    const title = String(proc.title || proc.process_number || nome).trim() || nome;
    const [cr] = await db.query(
      `INSERT INTO cases (user_id, client_id, partner_id, title, case_number, legal_area, status,
                          production_stage, production_started_at, production_labels, description)
       VALUES (?, ?, ?, ?, ?, ?, 'ativo', 'separacao_documentos', NOW(), ?, ?)`,
      [req.user!.id, clientId, partner.id, title, proc.process_number || null, area, labels, b.case_summary || null]
    ) as any;
    caseIds.push(cr.insertId);
  }

  // Entrada por protocolo (100% do escritório) — uma receita pelo total
  const entrada = entradaValor(partner, processos.length);
  await db.query(
    `INSERT INTO financial_records (user_id, client_id, case_id, tipo, description, valor, status, due_date)
     VALUES (?, ?, ?, 'receita', ?, ?, 'pendente', CURDATE())`,
    [req.user!.id, clientId, caseIds[0] ?? null,
     `Entrada parceria ${partner.name} — ${nome} (${processos.length} protocolo${processos.length > 1 ? 's' : ''})`, entrada]
  );

  await logTimeline({
    clientId, caseId: caseIds[0] ?? null, eventType: 'parceria_registrada',
    description: `Cliente registrado pela parceria ${partner.name} — ${processos.length} processo(s) na esteira · entrada R$ ${entrada.toFixed(2)}.`,
    userId: req.user!.id,
  });

  res.status(201).json({ success: true, client_id: clientId, case_ids: caseIds, entrada });
});

// ── GET /api/partners/:id/cases — acompanhamento dos casos da parceria ──────
router.get('/:id/cases', async (req: Request, res: Response) => {
  const [rows] = await db.query(`
    SELECT c.id, c.title, c.case_number, c.legal_area, c.production_stage, c.production_started_at, c.status,
           DATEDIFF(NOW(), c.production_started_at) AS sla_days,
           cl.name AS client_name,
           (SELECT COALESCE(SUM(valor),0) FROM financial_records fr WHERE fr.case_id = c.id AND fr.tipo='receita') AS receita,
           (SELECT COALESCE(SUM(valor),0) FROM repasses r WHERE r.case_id = c.id) AS repasse_parceiro
      FROM cases c
      LEFT JOIN clients cl ON cl.id = c.client_id
     WHERE c.partner_id = ?
     ORDER BY c.created_at DESC`, [req.params.id]) as any;
  res.json(rows);
});

// ── POST /api/partners/cases/:caseId/resultado — êxito/sucumbência + repasse ─
// Calcula a receita do escritório e o repasse ao parceiro conforme o acordo:
// - êxito: receita = ganho × success_fee% (ex.: 30%); repasse = receita × split% (50%).
// - sucumbência: receita = valor recebido; repasse = valor × sucumbencia_split% (50%).
router.post('/cases/:caseId/resultado', async (req: Request, res: Response) => {
  const kind = req.body?.kind === 'sucumbencia' ? 'sucumbencia' : 'exito';
  const val = Number(req.body?.amount) || 0;
  if (val <= 0) { res.status(400).json({ error: 'Informe o valor (maior que zero)' }); return; }

  const [[c]] = await db.query(`
    SELECT c.id, c.client_id, cl.name AS client_name, c.partner_id,
           p.name AS partner_name, p.success_fee_percent, p.partner_split_percent, p.sucumbencia_split_percent
      FROM cases c
      LEFT JOIN clients cl ON cl.id = c.client_id
      LEFT JOIN partners p ON p.id = c.partner_id
     WHERE c.id = ?`, [req.params.caseId]) as any;
  if (!c || !c.partner_id) { res.status(404).json({ error: 'Caso de parceria não encontrado' }); return; }

  let receita = 0, repasse = 0, desc = '', pct = 0;
  if (kind === 'sucumbencia') {
    pct = Number(c.sucumbencia_split_percent) || 50;
    receita = val;
    repasse = val * pct / 100;
    desc = `Sucumbência — ${c.client_name}`;
  } else {
    const feePct = Number(c.success_fee_percent) || 30;
    pct = Number(c.partner_split_percent) || 50;
    receita = val * feePct / 100;       // o escritório recebe o % do êxito
    repasse = receita * pct / 100;      // metade desse % vai ao parceiro
    desc = `Êxito (${feePct}% sobre R$ ${val.toFixed(2)}) — ${c.client_name}`;
  }
  receita = Math.round(receita * 100) / 100;
  repasse = Math.round(repasse * 100) / 100;

  await db.query(
    `INSERT INTO financial_records (user_id, client_id, case_id, tipo, description, valor, status, due_date)
     VALUES (?, ?, ?, 'receita', ?, ?, 'pendente', CURDATE())`,
    [req.user!.id, c.client_id, c.id, desc, receita]
  );
  await db.query(
    `INSERT INTO repasses (case_id, parceiro, tipo, valor, percentual, descricao, status, data_vencimento)
     VALUES (?, ?, 'indicacao', ?, ?, ?, 'pendente', CURDATE())`,
    [c.id, c.partner_name, repasse, pct, `Repasse ${kind === 'sucumbencia' ? 'sucumbência' : 'êxito'} — ${c.client_name}`]
  );

  await logTimeline({
    clientId: c.client_id, caseId: c.id, eventType: `parceria_${kind}`,
    description: `${kind === 'sucumbencia' ? 'Sucumbência' : 'Êxito'} registrado: receita R$ ${receita.toFixed(2)} · repasse ${c.partner_name} R$ ${repasse.toFixed(2)}.`,
    userId: req.user!.id,
  });

  res.json({ success: true, receita, repasse });
});

export default router;
