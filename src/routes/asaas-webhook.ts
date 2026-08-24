import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { confirmarPagamento } from './payments';

const router = Router();

// ── POST /api/public/asaas-webhook — confirmação automática de pagamento ────
// Configurado no painel do Asaas (Integrações → Webhooks). O token de
// assinatura vem no header 'asaas-access-token' e precisa bater com o
// configurado em office_settings.asaas_webhook_token.
router.post('/asaas-webhook', async (req: Request, res: Response) => {
  const [[cfg]] = await db.query(
    "SELECT setting_value FROM office_settings WHERE setting_key = 'asaas_webhook_token'"
  ) as any;
  const expected = cfg?.setting_value;
  const received = req.header('asaas-access-token');
  if (!expected || received !== expected) { res.status(401).json({ error: 'Token inválido' }); return; }

  const event = req.body?.event;
  const payment = req.body?.payment;
  if (!payment?.id) { res.status(200).json({ ok: true }); return; } // evento sem payment relevante — ignora sem erro

  if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
    const [[row]] = await db.query(
      "SELECT id FROM payments WHERE provider_txn_id = ?", [payment.id]
    ) as any;
    if (row) await confirmarPagamento(row.id, null);
  }

  res.status(200).json({ ok: true }); // sempre 200 — Asaas reenvia em loop se não receber 200
});

export default router;
