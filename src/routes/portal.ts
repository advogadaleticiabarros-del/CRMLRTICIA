import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../config/database';
import { buildPixPayload, pixQrDataUri } from '../services/pixService';
import { notificationService } from '../services/NotificationService';
import { sendEmail, isEmailConfigured } from '../services/EmailService';

const router = Router();

// Carrega o client_id do usuário logado. Bloqueia quem não está vinculado a um cliente.
async function loadClientId(req: Request, res: Response, next: NextFunction): Promise<void> {
  const [rows] = await db.query('SELECT client_id FROM users WHERE id = ?', [req.user!.id]) as any;
  const clientId = rows[0]?.client_id;
  if (!clientId) {
    res.status(403).json({ error: 'Acesso ao portal disponível apenas para clientes vinculados' });
    return;
  }
  (req as any).clientId = clientId;
  next();
}

router.use(loadClientId);

// ── GET /api/portal/me — resumo do cliente ──────────────────────────────────
router.get('/me', async (req: Request, res: Response) => {
  const clientId = (req as any).clientId;
  const [client] = await db.query('SELECT id, name, email, phone FROM clients WHERE id = ?', [clientId]) as any;
  const [[resumo]] = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM cases WHERE client_id = ? AND status = 'ativo') AS processos_ativos,
      (SELECT COALESCE(SUM(valor),0) FROM installments WHERE client_id = ? AND status = 'pendente') AS a_pagar,
      (SELECT COALESCE(SUM(valor),0) FROM installments WHERE client_id = ? AND status = 'pendente' AND due_date < CURDATE()) AS vencido
  `, [clientId, clientId, clientId]) as any;
  res.json({ ...client[0], resumo });
});

// ── GET /api/portal/cases — meus processos (com estágio de produção) ────────
router.get('/cases', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT id, case_number, title, legal_area, phase, status, production_stage, client_message, created_at
     FROM cases WHERE client_id = ? ORDER BY created_at DESC`,
    [(req as any).clientId]
  ) as any;
  res.json(rows);
});

// ── GET /api/portal/timeline — meu histórico ────────────────────────────────
router.get('/timeline', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT t.event_type, t.description, t.created_at, c.case_number
     FROM client_timeline t
     LEFT JOIN cases c ON c.id = t.case_id
     WHERE t.client_id = ? ORDER BY t.created_at DESC LIMIT 50`,
    [(req as any).clientId]
  ) as any;
  res.json(rows);
});

// ── GET /api/portal/cases/:id — andamento do processo (somente se for meu) ──
router.get('/cases/:id', async (req: Request, res: Response) => {
  const clientId = (req as any).clientId;
  const [rows] = await db.query(
    'SELECT id, case_number, title, legal_area, phase, status, production_stage, client_message FROM cases WHERE id = ? AND client_id = ?',
    [req.params.id, clientId]
  ) as any;
  if (!rows.length) { res.status(404).json({ error: 'Processo não encontrado' }); return; }

  const [movements] = await db.query(
    'SELECT description, movement_date, created_at FROM case_movements WHERE case_id = ? ORDER BY COALESCE(movement_date, created_at) DESC LIMIT 50',
    [req.params.id]
  ) as any;

  const [documents] = await db.query(
    "SELECT id, name, file_url, created_at FROM documents WHERE case_id = ? AND client_id = ? AND visible_to_client = 1 AND file_url IS NOT NULL AND file_url <> '' ORDER BY created_at DESC",
    [req.params.id, clientId]
  ) as any;

  res.json({ ...rows[0], movements, documents });
});

// ── GET /api/portal/financial — meus valores a pagar ────────────────────────
router.get('/financial', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT i.id, i.numero, i.valor, i.due_date, i.status, p.title AS proposta,
            CASE WHEN i.status = 'pendente' AND i.due_date < CURDATE() THEN 1 ELSE 0 END AS vencida
     FROM installments i
     LEFT JOIN propostas p ON p.id = i.proposta_id
     WHERE i.client_id = ? ORDER BY i.due_date ASC`,
    [(req as any).clientId]
  ) as any;
  res.json(rows);
});

// ── GET /api/portal/documents — documentos liberados para mim ───────────────
router.get('/documents', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT d.id, d.name, d.file_url, d.created_at, c.title AS case_title
       FROM documents d LEFT JOIN cases c ON c.id = d.case_id
      WHERE d.client_id = ? AND d.visible_to_client = 1 AND d.file_url IS NOT NULL AND d.file_url <> ''
      ORDER BY d.created_at DESC`, [(req as any).clientId]) as any;
  res.json(rows);
});

// ── GET /api/portal/contact — canal com o escritório (WhatsApp) ─────────────
router.get('/contact', async (_req: Request, res: Response) => {
  const [rows] = await db.query("SELECT setting_value FROM office_settings WHERE setting_key = 'whatsapp'") as any;
  res.json({ whatsapp: rows[0]?.setting_value || '' });
});

// ── GET /api/portal/pix/:installmentId — dados do Pix para pagar a parcela ──
router.get('/pix/:installmentId', async (req: Request, res: Response) => {
  const clientId = (req as any).clientId;
  const [[inst]] = await db.query(
    "SELECT id, valor, numero FROM installments WHERE id = ? AND client_id = ? AND status IN ('pendente','vencido')",
    [req.params.installmentId, clientId]) as any;
  if (!inst) { res.status(404).json({ error: 'Parcela não encontrada ou já paga' }); return; }
  const [cfg] = await db.query("SELECT setting_key, setting_value FROM office_settings WHERE setting_key IN ('pix_key','pix_nome','pix_cidade')") as any;
  const map: Record<string, string> = {};
  for (const r of cfg) map[r.setting_key] = r.setting_value || '';
  if (!map.pix_key) { res.status(400).json({ error: 'O escritório ainda não configurou a chave Pix' }); return; }
  const payload = buildPixPayload({
    key: map.pix_key, name: map.pix_nome || 'ADVOCACIA', city: map.pix_cidade || 'BRASIL',
    amount: Number(inst.valor), txid: `PARC${inst.id}`,
  });
  const qr = await pixQrDataUri(payload);
  res.json({ payload, qr, valor: Number(inst.valor), numero: inst.numero, beneficiario: map.pix_nome || '' });
});

// ── POST /api/portal/installments/:id/pagar — cliente declara o pagamento ───
// A parcela fica "em processamento" até o escritório conferir e dar baixa.
router.post('/installments/:id/pagar', async (req: Request, res: Response) => {
  const clientId = (req as any).clientId;
  const [[inst]] = await db.query(
    "SELECT id, valor, numero FROM installments WHERE id = ? AND client_id = ? AND status IN ('pendente','vencido')",
    [req.params.id, clientId]) as any;
  if (!inst) { res.status(404).json({ error: 'Parcela não encontrada ou já em processamento' }); return; }
  const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
  await db.query(
    "INSERT INTO payments (installment_id, client_id, method, status, amount, note) VALUES (?, ?, 'pix_manual', 'em_processamento', ?, ?)",
    [inst.id, clientId, inst.valor, note]);
  await db.query("UPDATE installments SET status = 'em_processamento' WHERE id = ?", [inst.id]);

  // Alerta ao escritório: sino p/ admins + e-mail (best-effort, nunca derruba a rota)
  const [[cl]] = await db.query('SELECT name FROM clients WHERE id = ?', [clientId]) as any;
  const [admins] = await db.query("SELECT id, email FROM users WHERE role = 'admin' AND active = 1") as any;
  for (const a of admins) {
    await notificationService.create({
      userId: a.id,
      title: 'Pagamento informado pelo cliente',
      message: `${cl?.name || 'Cliente'} marcou a parcela ${inst.numero ? inst.numero + 'ª' : ''} (R$ ${Number(inst.valor).toFixed(2)}) como paga — confira e dê baixa no Financeiro.`,
      notificationType: 'pagamento_informado',
      channel: 'sistema',
      scheduledAt: new Date(),
    }).catch(() => {});
    if (a.email && isEmailConfigured()) {
      sendEmail({
        to: a.email,
        subject: `Pagamento informado — ${cl?.name || 'Cliente'}`,
        html: `<p><strong>${cl?.name || 'Cliente'}</strong> informou o pagamento da parcela ${inst.numero ? inst.numero + 'ª' : ''} no valor de <strong>R$ ${Number(inst.valor).toFixed(2)}</strong>.</p><p>Confira o extrato e dê baixa em <em>Financeiro → Pagamentos a confirmar</em>.</p>`,
      }).catch(() => {});
    }
  }
  res.json({ success: true, status: 'em_processamento' });
});

export default router;
