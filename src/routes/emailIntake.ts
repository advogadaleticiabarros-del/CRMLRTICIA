import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../config/database';
import { env } from '../config/env';
import { enqueueIntake, confirmIntake, ParsedIntake } from '../services/emailIntake';
import { getInboxAuthUrl, getInboxStatus, updateInboxConfig, disconnectInbox, syncInboxNow, processAttachmentsForImport } from '../services/partnerInboxService';
import { createProductionFolder } from '../services/DriveService';

const router = Router();

// ── INTEGRAÇÃO GMAIL (Fase 2) ───────────────────────────────────────────────
router.get('/integration', async (_req: Request, res: Response) => {
  res.json(await getInboxStatus());
});

router.get('/integration/auth-url', (req: Request, res: Response) => {
  if (!env.GOOGLE_CLIENT_ID) { res.status(400).json({ error: 'OAuth Google não configurado no servidor' }); return; }
  const state = jwt.sign({ id: req.user!.id, purpose: 'inbox' }, env.JWT_SECRET, { expiresIn: '15m' });
  res.json({ url: getInboxAuthUrl(state) });
});

router.put('/integration', async (req: Request, res: Response) => {
  await updateInboxConfig({ sender_filter: req.body?.sender_filter, active: req.body?.active });
  res.json({ success: true });
});

router.post('/integration/disconnect', async (_req: Request, res: Response) => {
  await disconnectInbox();
  res.json({ success: true });
});

router.post('/integration/sync', async (req: Request, res: Response) => {
  try {
    const opts = req.body?.reset_sync ? { resetSync: true } : undefined;
    res.json({ success: true, ...(await syncInboxNow(req.user!.id, opts)) });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// ── GET /api/email-intake — fila de importações (pendentes primeiro) ────────
router.get('/', async (req: Request, res: Response) => {
  const status = req.query.status ? String(req.query.status) : null;
  const rows = status
    ? (await db.query('SELECT id, source, from_email, subject, parsed_json, partner_id, status, client_id, created_at, confirmed_at FROM email_imports WHERE status = ? ORDER BY created_at DESC LIMIT 200', [status]) as any)[0]
    : (await db.query("SELECT id, source, from_email, subject, parsed_json, partner_id, status, client_id, created_at, confirmed_at FROM email_imports ORDER BY (status='pendente') DESC, created_at DESC LIMIT 200") as any)[0];
  res.json(rows.map((r: any) => ({ ...r, parsed: r.parsed_json ? (typeof r.parsed_json === 'string' ? safeParse(r.parsed_json) : r.parsed_json) : null, parsed_json: undefined })));
});

function safeParse(s: string) { try { return JSON.parse(s); } catch { return null; } }

// ── POST /api/email-intake/parse — cola o e-mail (manual) e a IA estrutura ──
router.post('/parse', async (req: Request, res: Response) => {
  const raw = String(req.body?.raw_text || '').trim();
  if (!raw) { res.status(400).json({ error: 'Cole o texto do e-mail' }); return; }
  const out = await enqueueIntake({
    rawText: raw, source: 'manual',
    fromEmail: req.body?.from_email || null, subject: req.body?.subject || null,
    partnerId: req.body?.partner_id ? Number(req.body.partner_id) : null, createdBy: req.user!.id,
  }); // assunto entra na análise da IA (contrapartes podem estar no assunto)
  if (!out.parsed) {
    res.status(200).json({ id: out.id, parsed: null, warning: 'A IA não conseguiu estruturar automaticamente. Edite os dados manualmente antes de confirmar.' });
    return;
  }
  res.status(201).json({ id: out.id, parsed: out.parsed });
});

// ── PUT /api/email-intake/:id — edita os dados estruturados antes de confirmar
router.put('/:id', async (req: Request, res: Response) => {
  const parsed = req.body?.parsed as ParsedIntake;
  if (!parsed?.cliente?.nome) { res.status(400).json({ error: 'Informe ao menos o nome do cliente' }); return; }
  const [r] = await db.query("UPDATE email_imports SET parsed_json = ? WHERE id = ? AND status = 'pendente'", [JSON.stringify(parsed), req.params.id]) as any;
  if (!r.affectedRows) { res.status(404).json({ error: 'Importação pendente não encontrada' }); return; }
  res.json({ success: true });
});

// ── POST /api/email-intake/:id/confirm — cria cliente + casos + entrada ─────
router.post('/:id/confirm', async (req: Request, res: Response) => {
  try {
    const override = req.body?.parsed as ParsedIntake | undefined;
    const out = await confirmIntake(Number(req.params.id), req.user!.id, override);
    // Anexos do e-mail (Gmail) → Google Drive, vinculados ao caso.
    let anexos = 0;
    try { anexos = await processAttachmentsForImport(Number(req.params.id), out.clientId, out.caseIds[0] ?? null, req.user!.id); } catch { /* Drive indisponível não trava a confirmação */ }

    // Auto-criar pasta Drive individual por caso (igual ao fluxo manual de parceria)
    if (out.caseIds.length > 0) {
      try {
        const [cases] = await db.query(
          `SELECT c.id, c.title, c.legal_area, cl.name AS client_name
             FROM cases c LEFT JOIN clients cl ON cl.id = c.client_id
            WHERE c.id IN (${out.caseIds.map(() => '?').join(',')})`,
          out.caseIds
        ) as any;
        for (const c of cases) {
          createProductionFolder(req.user!.id, c.client_name || 'Cliente', c.legal_area || 'Geral', (c.title || '').substring(0, 50))
            .then((result) => {
              if (result) db.query('UPDATE cases SET drive_folder_url = ? WHERE id = ?', [result.folderUrl, c.id]).catch(() => {});
            })
            .catch(() => {});
        }
      } catch { /* silent — não bloqueia o retorno */ }
    }

    res.json({ success: true, ...out, anexos });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// ── POST /api/email-intake/:id/discard — descarta a importação ──────────────
router.post('/:id/discard', async (req: Request, res: Response) => {
  const [r] = await db.query("UPDATE email_imports SET status = 'descartado' WHERE id = ?", [req.params.id]) as any;
  if (!r.affectedRows) { res.status(404).json({ error: 'Importação não encontrada' }); return; }
  res.json({ success: true });
});

export default router;
