import { Router, Request, Response } from 'express';
import {
  importStatement, getConsolidatedSummary, getMonthlySeries, getPendentes, getEntries,
  saveRuleFromReview, RuleConflictError,
} from '../services/bankStatementService';
import { db } from '../config/database';

const router = Router();

const MAX_CSV_BYTES = 2 * 1024 * 1024; // 2MB — extrato mensal real tem ~10-15KB

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ── POST /api/bank-statement/import — sobe o CSV do mês ─────────────────────
router.post('/import', async (req: Request, res: Response) => {
  const csvText = req.body?.csv_text;
  const filename = req.body?.filename || null;
  if (!csvText || typeof csvText !== 'string') { res.status(400).json({ error: 'csv_text é obrigatório' }); return; }
  if (Buffer.byteLength(csvText, 'utf8') > MAX_CSV_BYTES) { res.status(400).json({ error: 'Arquivo grande demais (máx. 2MB) — confirme se é o extrato certo' }); return; }

  try {
    const result = await importStatement(csvText, filename, req.user!.id);
    res.status(201).json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message || 'Não foi possível importar o extrato' });
  }
});

function filtersFromQuery(req: Request) {
  return {
    type: (req.query.type as string) || undefined,
    category: (req.query.category as string) || undefined,
    escopo: (req.query.escopo as string) || undefined,
    counterparty: (req.query.counterparty as string) || undefined,
  };
}

// ── GET /api/bank-statement/summary?month=&type=&category=&escopo=&counterparty=&months= ──
router.get('/summary', async (req: Request, res: Response) => {
  const month = (req.query.month as string) || currentMonth();
  const summary = await getConsolidatedSummary(month, filtersFromQuery(req));
  const months = Math.min(24, Math.max(1, parseInt(req.query.months as string) || 6));
  const from = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 - (months - 1), 1);
  const fromYm = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`;
  const por_mes = await getMonthlySeries(fromYm, months);
  res.json({ ...summary, por_mes });
});

// ── GET /api/bank-statement/entries?month=&type=&category=&escopo=&counterparty= ──
// O extrato de fato: cada lançamento do mês, um por linha.
router.get('/entries', async (req: Request, res: Response) => {
  const month = (req.query.month as string) || currentMonth();
  const rows = await getEntries(month, filtersFromQuery(req));
  res.json(rows);
});

// ── GET /api/bank-statement/pendentes?month= ─────────────────────────────────
router.get('/pendentes', async (req: Request, res: Response) => {
  const rows = await getPendentes((req.query.month as string) || undefined);
  res.json(rows);
});

// ── PATCH /api/bank-statement/:id/review — confirma categoria de uma pendência ──
router.patch('/:id/review', async (req: Request, res: Response) => {
  const { category, escopo, save_as_rule, force_ambiguous } = req.body || {};
  if (!category) { res.status(400).json({ error: 'category é obrigatória' }); return; }
  if (escopo !== 'empresa' && escopo !== 'pessoal') { res.status(400).json({ error: "escopo deve ser 'empresa' ou 'pessoal'" }); return; }

  try {
    const result = await saveRuleFromReview({
      id: Number(req.params.id), category, escopo,
      saveAsRule: !!save_as_rule, forceAmbiguous: !!force_ambiguous, userId: req.user!.id,
    });
    res.json({ success: true, id: Number(req.params.id), ...result });
  } catch (e: any) {
    if (e instanceof RuleConflictError) { res.status(409).json({ error: e.message, existing: e.existing }); return; }
    if (e?.status === 404) { res.status(404).json({ error: e.message }); return; }
    throw e;
  }
});

// ── GET /api/bank-statement/imports — histórico de uploads ──────────────────
router.get('/imports', async (_req: Request, res: Response) => {
  const [rows] = await db.query('SELECT * FROM bank_statement_imports ORDER BY created_at DESC LIMIT 50') as any;
  res.json(rows);
});

export default router;
