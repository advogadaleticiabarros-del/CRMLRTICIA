import { Router, Request, Response } from 'express';
import {
  importCardStatement, getCardSummary, getCardEntries, getCardPendentes, reviewCardEntry,
} from '../services/cardStatementService';
import { db } from '../config/database';

const router = Router();

const MAX_CSV_BYTES = 2 * 1024 * 1024;

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ── POST /api/card-statement/import — sobe o CSV da fatura ──────────────────
router.post('/import', async (req: Request, res: Response) => {
  const csvText = req.body?.csv_text;
  const filename = req.body?.filename || null;
  if (!csvText || typeof csvText !== 'string') { res.status(400).json({ error: 'csv_text é obrigatório' }); return; }
  if (Buffer.byteLength(csvText, 'utf8') > MAX_CSV_BYTES) { res.status(400).json({ error: 'Arquivo grande demais (máx. 2MB)' }); return; }

  try {
    const result = await importCardStatement(csvText, filename, req.user!.id);
    res.status(201).json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message || 'Não foi possível importar a fatura' });
  }
});

// ── GET /api/card-statement/summary?month= ───────────────────────────────────
router.get('/summary', async (req: Request, res: Response) => {
  const month = (req.query.month as string) || currentMonth();
  res.json(await getCardSummary(month));
});

// ── GET /api/card-statement/entries?month= ────────────────────────────────────
router.get('/entries', async (req: Request, res: Response) => {
  const month = (req.query.month as string) || currentMonth();
  res.json(await getCardEntries(month));
});

// ── GET /api/card-statement/pendentes?month= ──────────────────────────────────
router.get('/pendentes', async (req: Request, res: Response) => {
  res.json(await getCardPendentes((req.query.month as string) || undefined));
});

// ── PATCH /api/card-statement/:id/review ──────────────────────────────────────
router.patch('/:id/review', async (req: Request, res: Response) => {
  const { category, save_as_rule } = req.body || {};
  if (!category) { res.status(400).json({ error: 'category é obrigatória' }); return; }
  try {
    await reviewCardEntry(Number(req.params.id), category, !!save_as_rule);
    res.json({ success: true, id: Number(req.params.id) });
  } catch (e: any) {
    if (e?.status === 404) { res.status(404).json({ error: e.message }); return; }
    throw e;
  }
});

// ── GET /api/card-statement/imports — histórico ──────────────────────────────
router.get('/imports', async (_req: Request, res: Response) => {
  const [rows] = await db.query('SELECT * FROM card_statement_imports ORDER BY created_at DESC LIMIT 50') as any;
  res.json(rows);
});

export default router;
