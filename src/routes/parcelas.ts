import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { logFinancialAudit } from '../services/FinancialAuditService';

const router = Router();

const STATUSES = ['aberto', 'pago', 'atrasado', 'parcial'];
const METODOS = ['pix', 'transferencia', 'boleto', 'cartao', 'cheque', 'dinheiro'];

const round2 = (n: number) => Math.round(n * 100) / 100;
function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/** Recalcula total_recebido / saldo_pendente / status da receita a partir das parcelas pagas. */
async function recalcReceita(receitaId: number): Promise<void> {
  const [[r]] = await db.query('SELECT valor FROM receitas WHERE id = ?', [receitaId]) as any;
  if (!r) return;
  const [[agg]] = await db.query(
    `SELECT COALESCE(SUM(rb.valor), 0) AS recebido
       FROM recebimentos rb
       JOIN parcelas p ON p.id = rb.parcela_id
      WHERE p.receita_id = ?`, [receitaId]
  ) as any;
  const recebido = Number(agg.recebido);
  const saldo = round2(Number(r.valor) - recebido);
  const status = recebido <= 0 ? 'aberto' : (recebido >= Number(r.valor) ? 'recebido' : 'parcial');
  await db.query(
    'UPDATE receitas SET total_recebido = ?, saldo_pendente = ?, status = ? WHERE id = ?',
    [round2(recebido), saldo, status, receitaId]
  );
}

// ── GET /api/parcelas — lista com filtros ───────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const status = req.query.status as string;
  const receitaId = req.query.receita_id as string;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
  const offset = (page - 1) * limit;

  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (status && STATUSES.includes(status)) { where.push('p.status = ?'); params.push(status); }
  if (receitaId) { where.push('p.receita_id = ?'); params.push(receitaId); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM parcelas p ${whereSql}`, params) as any;
  const [rows] = await db.query(
    `SELECT p.*, r.descricao AS receita_descricao, r.client_id,
            CASE WHEN p.status IN ('aberto','atrasado','parcial') AND p.data_vencimento < CURDATE() THEN 1 ELSE 0 END AS vencida
       FROM parcelas p
       JOIN receitas r ON r.id = p.receita_id
       ${whereSql} ORDER BY p.data_vencimento ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as any;

  res.json({ data: rows, total, page, limit, pages: Math.ceil(total / limit) });
});

// ── GET /api/parcelas/receita/:receitaId/totais ─────────────────────────────
router.get('/receita/:receitaId/totais', async (req: Request, res: Response) => {
  const rid = req.params.receitaId;
  const [[t]] = await db.query(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'pago' THEN valor_final END), 0)                          AS total_pago,
      COALESCE(SUM(CASE WHEN status IN ('aberto','parcial','atrasado') THEN valor_final END), 0) AS total_aberto,
      COALESCE(SUM(CASE WHEN status IN ('aberto','parcial','atrasado')
                         AND data_vencimento < CURDATE() THEN valor_final END), 0)              AS total_vencido
    FROM parcelas WHERE receita_id = ?`, [rid]) as any;
  const [[prox]] = await db.query(
    `SELECT MIN(data_vencimento) AS proximo_pagamento FROM parcelas
      WHERE receita_id = ? AND status IN ('aberto','parcial','atrasado') AND data_vencimento >= CURDATE()`,
    [rid]
  ) as any;
  res.json({ ...t, proximo_pagamento: prox.proximo_pagamento });
});

// ── GET /api/parcelas/:id ───────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT p.*, r.descricao AS receita_descricao, r.client_id, r.case_id
       FROM parcelas p JOIN receitas r ON r.id = p.receita_id WHERE p.id = ?`, [req.params.id]
  ) as any;
  if (!rows.length) { res.status(404).json({ error: 'Parcela não encontrada' }); return; }
  res.json(rows[0]);
});

// ── POST /api/parcelas — criar parcela avulsa ───────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { receita_id, numero, total_parcelas, valor, juros, desconto, data_vencimento } = req.body;
  if (!receita_id) { res.status(400).json({ error: 'receita_id é obrigatório' }); return; }
  if (!data_vencimento) { res.status(400).json({ error: 'data_vencimento é obrigatória' }); return; }
  const [rec] = await db.query('SELECT id FROM receitas WHERE id = ?', [receita_id]) as any;
  if (!rec.length) { res.status(404).json({ error: 'Receita não encontrada' }); return; }

  const v = Number(valor) || 0;
  const j = Number(juros) || 0;
  const d = Number(desconto) || 0;
  const valorFinal = round2(v + j - d);

  const [result] = await db.query(
    `INSERT INTO parcelas
       (receita_id, numero, total_parcelas, valor, juros, desconto, valor_final, status, data_vencimento)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', ?)`,
    [receita_id, Number(numero) || 1, Number(total_parcelas) || 1, v, j, d, valorFinal, data_vencimento]
  ) as any;

  await logFinancialAudit({
    entityType: 'Parcela', entityId: result.insertId, action: 'created',
    userId: req.user!.id, userName: req.user!.name, receitaId: Number(receita_id), parcelaId: result.insertId,
    newValue: valorFinal, newStatus: 'aberto', reason: 'Parcela criada via API', ipAddress: req.ip,
  });

  const [rows] = await db.query('SELECT * FROM parcelas WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── POST /api/parcelas/gerar — gerar parcelas automáticas ───────────────────
router.post('/gerar', async (req: Request, res: Response) => {
  const { receita_id, total_parcelas, data_inicio, dias_intervalo } = req.body;
  const total = parseInt(total_parcelas);
  if (!receita_id || !total || total < 1) { res.status(400).json({ error: 'receita_id e total_parcelas (>=1) são obrigatórios' }); return; }
  if (!data_inicio) { res.status(400).json({ error: 'data_inicio é obrigatória' }); return; }
  const intervalo = parseInt(dias_intervalo) || 30;

  const [recRows] = await db.query('SELECT valor FROM receitas WHERE id = ?', [receita_id]) as any;
  if (!recRows.length) { res.status(404).json({ error: 'Receita não encontrada' }); return; }

  const valorParcela = round2(Number(recRows[0].valor) / total);
  const criadas: number[] = [];
  for (let i = 1; i <= total; i++) {
    const venc = addDaysStr(data_inicio, (i - 1) * intervalo);
    const [r] = await db.query(
      `INSERT INTO parcelas
         (receita_id, numero, total_parcelas, valor, juros, desconto, valor_final, status, data_vencimento)
       VALUES (?, ?, ?, ?, 0, 0, ?, 'aberto', ?)`,
      [receita_id, i, total, valorParcela, valorParcela, venc]
    ) as any;
    criadas.push(r.insertId);
  }

  await logFinancialAudit({
    entityType: 'Parcela', entityId: criadas[0] ?? 0, action: 'created',
    userId: req.user!.id, userName: req.user!.name, receitaId: Number(receita_id),
    reason: `Geradas ${total} parcelas automaticamente`, ipAddress: req.ip,
  });

  const [rows] = await db.query('SELECT * FROM parcelas WHERE receita_id = ? ORDER BY numero ASC', [receita_id]) as any;
  res.status(201).json(rows);
});

// ── PUT /api/parcelas/:id — atualizar (recalcula valor_final) ───────────────
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT * FROM parcelas WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Parcela não encontrada' }); return; }
  const prev = existing[0];

  const valor = req.body.valor !== undefined ? Number(req.body.valor) : Number(prev.valor);
  const juros = req.body.juros !== undefined ? Number(req.body.juros) : Number(prev.juros);
  const desconto = req.body.desconto !== undefined ? Number(req.body.desconto) : Number(prev.desconto);
  const dataVenc = req.body.data_vencimento || prev.data_vencimento;
  const valorFinal = round2(valor + juros - desconto);

  await db.query(
    'UPDATE parcelas SET valor = ?, juros = ?, desconto = ?, valor_final = ?, data_vencimento = ? WHERE id = ?',
    [valor, juros, desconto, valorFinal, dataVenc, id]
  );
  await logFinancialAudit({
    entityType: 'Parcela', entityId: Number(id), action: 'updated',
    userId: req.user!.id, userName: req.user!.name, receitaId: prev.receita_id, parcelaId: Number(id),
    oldValue: prev.valor_final, newValue: valorFinal, reason: 'Parcela atualizada via API', ipAddress: req.ip,
  });

  const [rows] = await db.query('SELECT * FROM parcelas WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

// ── POST /api/parcelas/:id/pagar — baixa: registra recebimento + recalcula ──
router.post('/:id/pagar', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { data_pagamento, valor, metodo, comprovante } = req.body;
  const [existing] = await db.query('SELECT * FROM parcelas WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Parcela não encontrada' }); return; }
  const prev = existing[0];
  if (prev.status === 'pago') { res.json(prev); return; }

  const dataPg = data_pagamento || new Date().toISOString().split('T')[0];
  const valorPago = valor !== undefined ? Number(valor) : Number(prev.valor_final);
  const metodoPg = METODOS.includes(metodo) ? metodo : 'pix';

  // Registra o recebimento
  await db.query(
    'INSERT INTO recebimentos (parcela_id, data, valor, metodo, comprovante) VALUES (?, ?, ?, ?, ?)',
    [id, dataPg, valorPago, metodoPg, comprovante ?? null]
  );
  // Marca a parcela como paga
  await db.query(
    'UPDATE parcelas SET status = ?, data_pagamento = ?, comprovante = COALESCE(?, comprovante) WHERE id = ?',
    ['pago', dataPg, comprovante ?? null, id]
  );
  // Recalcula a receita-mãe
  await recalcReceita(prev.receita_id);
  // Resolve eventual inadimplência da parcela
  await db.query(
    "UPDATE inadimplencias SET status = 'resolvido', data_resolucao = NOW() WHERE parcela_id = ? AND status <> 'resolvido'",
    [id]
  );

  await logFinancialAudit({
    entityType: 'Parcela', entityId: Number(id), action: 'paid',
    userId: req.user!.id, userName: req.user!.name, receitaId: prev.receita_id, parcelaId: Number(id),
    oldStatus: prev.status, newStatus: 'pago', newValue: valorPago,
    reason: `Parcela ${prev.numero} paga (${metodoPg})`, ipAddress: req.ip,
  });

  const [rows] = await db.query('SELECT * FROM parcelas WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

// ── DELETE /api/parcelas/:id ────────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT * FROM parcelas WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Parcela não encontrada' }); return; }
  const prev = existing[0];

  await db.query('DELETE FROM parcelas WHERE id = ?', [id]);
  await recalcReceita(prev.receita_id);
  await logFinancialAudit({
    entityType: 'Parcela', entityId: Number(id), action: 'deleted',
    userId: req.user!.id, userName: req.user!.name, receitaId: prev.receita_id,
    reason: `Parcela ${prev.numero} removida via API`, ipAddress: req.ip,
  });
  res.json({ success: true, id: Number(id) });
});

export default router;
