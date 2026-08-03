import { Router, Request, Response } from 'express';
import { getExecutiveReportData } from '../../services/executiveReport';

const router = Router();

/**
 * Relatório mensal EXECUTIVO — o escritório inteiro num documento só:
 * faturamento por frente, processos protocolados (com número e se é caso
 * próprio ou de parceria), movimentação processual, agenda, funil comercial,
 * inadimplência e produção. O front imprime no papel timbrado (salvar como
 * PDF) e o mesmo dado alimenta o e-mail automático do dia 1 — ver
 * services/executiveReport.ts e monthlyExecutiveReportEmail.ts.
 */
router.get('/', async (req: Request, res: Response) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month))
    ? String(req.query.month)
    : new Date().toISOString().slice(0, 7);
  res.json(await getExecutiveReportData(month));
});

// ── POST /api/dashboards/relatorio-mensal/enviar — dispara o e-mail na hora ──
// Mesmo envio do cron do dia 1, só que sob demanda (testar/reenviar sem esperar).
router.post('/enviar', async (req: Request, res: Response) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.body?.month)) ? String(req.body.month) : undefined;
  const { sendMonthlyExecutiveReportEmail } = await import('../../services/monthlyExecutiveReportEmail');
  const r = await sendMonthlyExecutiveReportEmail(month);
  if (!r.ok) { res.status(r.skipped ? 500 : 502).json({ error: r.skipped ? 'E-mail não configurado no servidor' : (r.error || 'Falha ao enviar') }); return; }
  res.json({ success: true, month: r.month });
});

export default router;
