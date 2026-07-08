import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { logTimeline } from '../services/TimelineService';

const router = Router();

// ── GET /api/payments — fila de pagamentos declarados (default: em processamento)
router.get('/', async (req: Request, res: Response) => {
  const status = ['em_processamento', 'confirmado', 'recusado'].includes(String(req.query.status))
    ? String(req.query.status) : 'em_processamento';
  const [rows] = await db.query(
    `SELECT p.id, p.installment_id, p.client_id, p.method, p.status, p.amount, p.note, p.created_at,
            cl.name AS client_name, i.numero, i.due_date, i.valor AS parcela_valor, pr.title AS proposta
       FROM payments p
       JOIN clients cl ON cl.id = p.client_id
       JOIN installments i ON i.id = p.installment_id
       LEFT JOIN propostas pr ON pr.id = i.proposta_id
      WHERE p.status = ?
      ORDER BY p.created_at ASC`, [status]) as any;
  res.json(rows);
});

// ── POST /api/payments/:id/confirmar — baixa de fato a parcela ──────────────
router.post('/:id/confirmar', async (req: Request, res: Response) => {
  const [[p]] = await db.query("SELECT * FROM payments WHERE id = ? AND status = 'em_processamento'", [req.params.id]) as any;
  if (!p) { res.status(404).json({ error: 'Pagamento não encontrado ou já tratado' }); return; }
  await db.query("UPDATE payments SET status = 'confirmado', confirmed_at = NOW(), confirmed_by = ? WHERE id = ?", [req.user!.id, p.id]);
  await db.query("UPDATE installments SET status = 'pago', paid_at = NOW() WHERE id = ?", [p.installment_id]);
  await logTimeline({
    clientId: p.client_id,
    eventType: 'financeiro',
    description: `Pagamento da parcela confirmado (R$ ${Number(p.amount).toFixed(2)})`,
    userId: req.user!.id,
  }).catch(() => {});

  // Recibo automático por e-mail (best-effort)
  try {
    const [[info]] = await db.query(
      `SELECT cl.name, cl.email, i.numero, pr.title AS proposta
         FROM clients cl
         JOIN installments i ON i.id = ?
         LEFT JOIN propostas pr ON pr.id = i.proposta_id
        WHERE cl.id = ?`, [p.installment_id, p.client_id]) as any;
    if (info?.email && info.email.includes('@')) {
      const { sendReceipt } = await import('../services/EmailService');
      sendReceipt(info.email, {
        name: info.name,
        valor: Number(p.amount),
        referencia: `${info.numero ? info.numero + 'ª parcela' : 'Parcela'}${info.proposta ? ` — ${info.proposta}` : ''}`,
        pagoEm: new Date(),
        numeroRecibo: `P${p.id}-${new Date().getFullYear()}`,
      }).catch(() => {});
    }
  } catch { /* recibo é best-effort */ }

  res.json({ success: true });
});

// ── POST /api/payments/:id/recusar — devolve a parcela para pendente ────────
router.post('/:id/recusar', async (req: Request, res: Response) => {
  const [[p]] = await db.query("SELECT * FROM payments WHERE id = ? AND status = 'em_processamento'", [req.params.id]) as any;
  if (!p) { res.status(404).json({ error: 'Pagamento não encontrado ou já tratado' }); return; }
  await db.query("UPDATE payments SET status = 'recusado', confirmed_at = NOW(), confirmed_by = ? WHERE id = ?", [req.user!.id, p.id]);
  await db.query("UPDATE installments SET status = 'pendente' WHERE id = ?", [p.installment_id]);
  res.json({ success: true });
});

export default router;
