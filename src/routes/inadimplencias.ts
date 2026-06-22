import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { logFinancialAudit } from '../services/FinancialAuditService';

const router = Router();

const STATUSES = [
  'alerta_1d', 'alerta_5d', 'alerta_10d', 'alerta_15d', 'alerta_30d',
  'cobranca_juridica', 'negociando', 'resolvido',
];

/** Define o status de alerta a partir dos dias de atraso. */
function statusPorDias(dias: number): string {
  if (dias >= 30) return 'alerta_30d';
  if (dias >= 15) return 'alerta_15d';
  if (dias >= 10) return 'alerta_10d';
  if (dias >= 5) return 'alerta_5d';
  return 'alerta_1d';
}

// ── GET /api/inadimplencias — lista com filtros ─────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const status = req.query.status as string;
  const clientId = req.query.client_id as string;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));
  const offset = (page - 1) * limit;

  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (status && STATUSES.includes(status)) { where.push('i.status = ?'); params.push(status); }
  if (clientId) { where.push('i.client_id = ?'); params.push(clientId); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM inadimplencias i ${whereSql}`, params) as any;
  const [rows] = await db.query(
    `SELECT i.*, cl.name AS client_name, p.numero AS parcela_numero, p.data_vencimento, r.descricao AS receita_descricao
       FROM inadimplencias i
       LEFT JOIN clients cl ON cl.id = i.client_id
       LEFT JOIN parcelas p ON p.id = i.parcela_id
       LEFT JOIN receitas r ON r.id = p.receita_id
       ${whereSql} ORDER BY i.dias_atraso DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ) as any;

  res.json({ data: rows, total, page, limit, pages: Math.ceil(total / limit) });
});

// ── POST /api/inadimplencias/recalcular — varre parcelas vencidas ───────────
router.post('/recalcular', async (req: Request, res: Response) => {
  // Parcelas em aberto/parcial/atrasado já vencidas
  const [vencidas] = await db.query(`
    SELECT p.id AS parcela_id, p.valor_final, r.client_id,
           DATEDIFF(CURDATE(), p.data_vencimento) AS dias_atraso
      FROM parcelas p
      JOIN receitas r ON r.id = p.receita_id
     WHERE p.status IN ('aberto','parcial','atrasado')
       AND p.data_vencimento < CURDATE()`) as any;

  let criadas = 0, atualizadas = 0;
  for (const v of vencidas) {
    const novoStatus = statusPorDias(Number(v.dias_atraso));
    // Marca a parcela como atrasada
    await db.query("UPDATE parcelas SET status = 'atrasado' WHERE id = ? AND status <> 'pago'", [v.parcela_id]);
    // Upsert na inadimplência (mantém status manual cobranca_juridica/negociando/resolvido)
    const [existing] = await db.query('SELECT id, status FROM inadimplencias WHERE parcela_id = ?', [v.parcela_id]) as any;
    if (!existing.length) {
      await db.query(
        `INSERT INTO inadimplencias (parcela_id, client_id, dias_atraso, valor, status, ultimo_alerta)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [v.parcela_id, v.client_id, v.dias_atraso, v.valor_final, novoStatus]
      );
      criadas++;
    } else {
      const manual = ['cobranca_juridica', 'negociando', 'resolvido'];
      const keepStatus = manual.includes(existing[0].status) ? existing[0].status : novoStatus;
      await db.query(
        'UPDATE inadimplencias SET dias_atraso = ?, valor = ?, status = ?, ultimo_alerta = NOW() WHERE id = ?',
        [v.dias_atraso, v.valor_final, keepStatus, existing[0].id]
      );
      atualizadas++;
    }
  }

  res.json({ verificadas: vencidas.length, criadas, atualizadas });
});

// ── PATCH /api/inadimplencias/:id — status / tentativas de cobrança ─────────
router.patch('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT * FROM inadimplencias WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Inadimplência não encontrada' }); return; }
  const prev = existing[0];

  const fields: string[] = [];
  const params: any[] = [];
  if (req.body.status !== undefined && STATUSES.includes(req.body.status)) {
    fields.push('status = ?'); params.push(req.body.status);
  }
  if (req.body.tentativas_cobranca !== undefined) {
    fields.push('tentativas_cobranca = ?'); params.push(Number(req.body.tentativas_cobranca));
  }
  if (req.body.registrar_tentativa) {
    fields.push('tentativas_cobranca = tentativas_cobranca + 1', 'ultimo_alerta = NOW()');
  }
  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido para atualizar' }); return; }
  params.push(id);
  await db.query(`UPDATE inadimplencias SET ${fields.join(', ')} WHERE id = ?`, params);

  await logFinancialAudit({
    entityType: 'Inadimplencia', entityId: Number(id), action: 'updated',
    userId: req.user!.id, userName: req.user!.name, clientId: prev.client_id, parcelaId: prev.parcela_id,
    oldStatus: prev.status, newStatus: req.body.status ?? prev.status,
    reason: req.body.reason || 'Inadimplência atualizada', ipAddress: req.ip,
  });

  const [rows] = await db.query('SELECT * FROM inadimplencias WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

// ── POST /api/inadimplencias/:id/resolver ───────────────────────────────────
router.post('/:id/resolver', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT * FROM inadimplencias WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Inadimplência não encontrada' }); return; }
  const prev = existing[0];

  await db.query("UPDATE inadimplencias SET status = 'resolvido', data_resolucao = NOW() WHERE id = ?", [id]);
  await logFinancialAudit({
    entityType: 'Inadimplencia', entityId: Number(id), action: 'closed',
    userId: req.user!.id, userName: req.user!.name, clientId: prev.client_id, parcelaId: prev.parcela_id,
    oldStatus: prev.status, newStatus: 'resolvido', reason: req.body?.reason || 'Inadimplência resolvida', ipAddress: req.ip,
  });
  const [rows] = await db.query('SELECT * FROM inadimplencias WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

export default router;
