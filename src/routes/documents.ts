import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../config/database';
import { logTimeline } from '../services/TimelineService';

const router = Router();

// Pastas automáticas (GED) por cliente
export const FOLDERS = ['contratos', 'procuracoes', 'documentos_pessoais', 'processos', 'financeiro', 'audiencias', 'outros'];
const STATUSES = ['pendente', 'recebido', 'assinado', 'arquivado'];

const round = (s: string) => s;
function dataExtenso(): string {
  return new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

// ── TEMPLATES ───────────────────────────────────────────────────────────────
router.get('/templates', async (_req: Request, res: Response) => {
  const [rows] = await db.query('SELECT id, name, category, content, instructions, applies_to, legal_basis, piece_type, updated_at FROM document_templates ORDER BY category, name') as any;
  res.json(rows);
});

router.post('/templates', async (req: Request, res: Response) => {
  const { name, category, content, piece_type } = req.body;
  if (!name || !content) { res.status(400).json({ error: 'Nome e conteúdo são obrigatórios' }); return; }
  const [r] = await db.query(
    'INSERT INTO document_templates (name, category, content, piece_type, created_by) VALUES (?, ?, ?, ?, ?)',
    [name.trim(), category || 'outros', content, piece_type || null, req.user!.id]
  ) as any;
  const [rows] = await db.query('SELECT * FROM document_templates WHERE id = ?', [r.insertId]) as any;
  res.status(201).json(rows[0]);
});

router.put('/templates/:id', async (req: Request, res: Response) => {
  const fields: string[] = []; const params: any[] = [];
  const setIf = (c: string, v: any) => { if (v !== undefined) { fields.push(`${c} = ?`); params.push(v); } };
  setIf('name', req.body.name?.trim?.());
  setIf('category', req.body.category);
  setIf('content', req.body.content);
  setIf('piece_type', req.body.piece_type === '' ? null : req.body.piece_type);
  if (!fields.length) { res.status(400).json({ error: 'Nada para atualizar' }); return; }
  params.push(req.params.id);
  const [r] = await db.query(`UPDATE document_templates SET ${fields.join(', ')} WHERE id = ?`, params) as any;
  if (!r.affectedRows) { res.status(404).json({ error: 'Modelo não encontrado' }); return; }
  res.json({ success: true });
});

router.delete('/templates/:id', async (req: Request, res: Response) => {
  const [r] = await db.query('DELETE FROM document_templates WHERE id = ?', [req.params.id]) as any;
  if (!r.affectedRows) { res.status(404).json({ error: 'Modelo não encontrado' }); return; }
  res.json({ success: true });
});

// ── GERAÇÃO a partir de template + cliente/caso ─────────────────────────────
router.post('/generate', async (req: Request, res: Response) => {
  const { template_id, client_id, case_id, juizo, numero_processo, extra } = req.body;
  if (!template_id || !client_id) { res.status(400).json({ error: 'template_id e client_id são obrigatórios' }); return; }

  const [[tpl]] = await db.query('SELECT * FROM document_templates WHERE id = ?', [template_id]) as any;
  if (!tpl) { res.status(404).json({ error: 'Modelo não encontrado' }); return; }
  const [[client]] = await db.query('SELECT * FROM clients WHERE id = ?', [client_id]) as any;
  if (!client) { res.status(404).json({ error: 'Cliente não encontrado' }); return; }

  let proc: any = null;
  if (case_id) { const [[c]] = await db.query('SELECT * FROM cases WHERE id = ?', [case_id]) as any; proc = c; }
  const [[lawyer]] = await db.query("SELECT name, oab_number, oab_uf FROM lawyers WHERE active = 1 ORDER BY id LIMIT 1") as any;
  // O banco guarda só os dígitos (formato usado pelo DJEN) — formata com o
  // ponto de milhar (39948 → 39.948) só na hora de exibir. Mesmo padrão já
  // usado em getEscritorio() para os contratos.
  const oabFormatado = lawyer?.oab_number && /^\d+$/.test(String(lawyer.oab_number))
    ? Number(lawyer.oab_number).toLocaleString('pt-BR') : lawyer?.oab_number;

  const map: Record<string, string> = {
    cliente_nome: client.name || '',
    cliente_cpf: client.cpf_cnpj || '',
    cliente_rg: client.rg || '',
    cliente_endereco: client.address || '',
    cliente_cidade: client.city || '',
    cliente_estado: client.state || '',
    cliente_profissao: client.profession || '',
    cliente_estado_civil: client.marital_status || '',
    // numero_processo/juizo digitados na hora prevalecem sobre o do caso vinculado —
    // uma habilitação em processo novo (ex.: homologação) muitas vezes não tem
    // relação 1:1 com o número de processo já cadastrado no caso do CRM.
    processo_numero: (numero_processo && String(numero_processo).trim()) || (proc ? (proc.case_number || proc.process_number || '') : ''),
    juizo: (juizo && String(juizo).trim()) || '',
    advogada_nome: lawyer?.name || '',
    advogada_oab: lawyer ? `${oabFormatado || ''}${lawyer.oab_uf ? '/' + lawyer.oab_uf : ''}` : '',
    data_extenso: dataExtenso(),
  };
  // Campos extras livres (ex.: dativo_parte, dativo_finalidade) — pra
  // documentos com trechos que variam caso a caso e não têm coluna própria
  // no cadastro do cliente/caso. Só string, com limite de tamanho.
  if (extra && typeof extra === 'object') {
    for (const k of Object.keys(extra)) {
      if (/^\w+$/.test(k)) map[k] = String(extra[k] ?? '').slice(0, 2000);
    }
  }
  const content = round(String(tpl.content).replace(/\{\{(\w+)\}\}/g, (_m, k) => (map[k] !== undefined ? map[k] : '')));

  const [r] = await db.query(
    `INSERT INTO documents (client_id, case_id, name, type, folder, content, template_id, status, created_by)
     VALUES (?, ?, ?, 'gerado', ?, ?, ?, 'pendente', ?)`,
    [client_id, case_id ?? null, tpl.name, tpl.category, content, template_id, req.user!.id]
  ) as any;

  await logTimeline({ clientId: client_id, caseId: case_id ?? null, eventType: 'documento_gerado',
    description: `Documento gerado: ${tpl.name}`, userId: req.user!.id });

  const [rows] = await db.query('SELECT * FROM documents WHERE id = ?', [r.insertId]) as any;
  res.status(201).json(rows[0]);
});

// ── DOCUMENTOS (GED) ────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const where: string[] = ['1=1']; const params: any[] = [];
  if (req.query.client_id) { where.push('d.client_id = ?'); params.push(req.query.client_id); }
  if (req.query.folder) { where.push('d.folder = ?'); params.push(req.query.folder); }
  const [rows] = await db.query(
    `SELECT d.id, d.client_id, d.case_id, d.name, d.type, d.folder, d.status, d.file_url,
            d.visible_to_client, (d.content IS NOT NULL) AS has_content, (d.data IS NOT NULL) AS has_data,
            d.created_at, c.name AS client_name
       FROM documents d LEFT JOIN clients c ON c.id = d.client_id
      WHERE ${where.join(' AND ')} ORDER BY d.created_at DESC LIMIT 500`, params
  ) as any;
  // Arquivos recebidos pelo WhatsApp: assina o link (HMAC 24h) para abrir em nova aba
  try {
    const { signMediaUrl } = await import('./whatsapp-instance');
    for (const r of rows) if (r.file_url && String(r.file_url).startsWith('/api/whatsapp-instance/media/')) r.file_url = signMediaUrl(r.file_url);
  } catch { /* opcional */ }
  res.json(rows);
});

router.get('/:id', async (req: Request, res: Response) => {
  const [rows] = await db.query('SELECT * FROM documents WHERE id = ?', [req.params.id]) as any;
  if (!rows.length) { res.status(404).json({ error: 'Documento não encontrado' }); return; }
  res.json(rows[0]);
});

router.post('/', async (req: Request, res: Response) => {
  const { client_id, case_id, name, folder, type, file_url, status, content, file_base64, mime } = req.body;
  if (!client_id) { res.status(400).json({ error: 'client_id é obrigatório' }); return; }
  if (!name || !String(name).trim()) { res.status(400).json({ error: 'O nome é obrigatório' }); return; }

  // Upload de arquivo (ex.: PDF/foto do documento assinado) — mesmo padrão
  // já usado pra minuta do acordo extrajudicial: base64 em JSON (sem multer
  // no projeto), guardado como blob em documents.data.
  let data: Buffer | null = null;
  if (file_base64) {
    data = Buffer.from(String(file_base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    const MAX = 15 * 1024 * 1024;
    if (data.length > MAX) { res.status(400).json({ error: 'Arquivo maior que 15MB' }); return; }
  }

  const [r] = await db.query(
    `INSERT INTO documents (client_id, case_id, name, type, folder, file_url, content, data, mime, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [client_id, case_id ?? null, name.trim(), type ?? null,
     FOLDERS.includes(folder) ? folder : 'outros', file_url ?? null, content ?? null,
     data, data ? (mime || 'application/octet-stream') : null,
     STATUSES.includes(status) ? status : 'recebido', req.user!.id]
  ) as any;
  const [rows] = await db.query(
    'SELECT id, client_id, case_id, name, type, folder, file_url, status, visible_to_client, (data IS NOT NULL) AS has_data, created_at FROM documents WHERE id = ?',
    [r.insertId]
  ) as any;
  res.status(201).json(rows[0]);
});

// ── GET /api/documents/:id/file — baixa o arquivo enviado (upload) ─────────
router.get('/:id/file', async (req: Request, res: Response) => {
  const [[doc]] = await db.query('SELECT name, mime, data FROM documents WHERE id = ?', [req.params.id]) as any;
  if (!doc || !doc.data) { res.status(404).json({ error: 'Arquivo não encontrado' }); return; }
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.name)}"`);
  res.send(doc.data);
});

router.put('/:id', async (req: Request, res: Response) => {
  const fields: string[] = []; const params: any[] = [];
  const setIf = (c: string, v: any, valid = true) => { if (v !== undefined && valid) { fields.push(`${c} = ?`); params.push(v); } };
  setIf('name', req.body.name?.trim?.());
  setIf('folder', req.body.folder, FOLDERS.includes(req.body.folder));
  setIf('status', req.body.status, STATUSES.includes(req.body.status));
  setIf('content', req.body.content);
  setIf('file_url', req.body.file_url);
  setIf('visible_to_client', req.body.visible_to_client === undefined ? undefined : (req.body.visible_to_client ? 1 : 0));
  if (!fields.length) { res.status(400).json({ error: 'Nada para atualizar' }); return; }
  params.push(req.params.id);
  await db.query(`UPDATE documents SET ${fields.join(', ')} WHERE id = ?`, params);
  const [rows] = await db.query('SELECT * FROM documents WHERE id = ?', [req.params.id]) as any;
  res.json(rows[0]);
});

router.delete('/:id', async (req: Request, res: Response) => {
  const [r] = await db.query('DELETE FROM documents WHERE id = ?', [req.params.id]) as any;
  if (!r.affectedRows) { res.status(404).json({ error: 'Documento não encontrado' }); return; }
  res.json({ success: true });
});

// ── Assinatura: cria solicitação (link público) ─────────────────────────────
router.post('/:id/sign-request', async (req: Request, res: Response) => {
  const [[doc]] = await db.query('SELECT id, content FROM documents WHERE id = ?', [req.params.id]) as any;
  if (!doc) { res.status(404).json({ error: 'Documento não encontrado' }); return; }
  if (!doc.content) { res.status(400).json({ error: 'Só é possível assinar documentos com conteúdo (gerados/editados)' }); return; }

  const token = crypto.randomUUID();
  const code = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 chars
  // Link exclusivo: se nome/CPF forem informados na criação, ficam travados
  // na tela de assinatura (ninguém mais consegue assinar nesse link no lugar
  // do signatário indicado) — ver GET/POST /api/public/sign/:token.
  await db.query(
    `INSERT INTO signature_requests (document_id, token, verification_code, signer_name, signer_cpf, party_label, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.params.id, token, code, req.body?.signer_name ?? null, req.body?.signer_cpf ?? null, req.body?.party_label ?? null, req.user!.id]
  );
  res.status(201).json({ token, verification_code: code, path: `/assinar.html?token=${token}` });
});

router.get('/:id/signatures', async (req: Request, res: Response) => {
  // signature_image e os campos de auditoria só vêm preenchidos quando
  // status='assinado' — usados pra montar o documento final com a assinatura
  // de verdade no lugar certo + página de autenticação anexada (ver "Baixar
  // documento assinado" em public/app.js).
  const [rows] = await db.query(
    `SELECT id, token, verification_code, signer_name, signer_cpf, signer_email, signer_phone,
            party_label, status, signed_at, signer_ip, signature_image, doc_hash,
            geo_lat, geo_lng, geo_accuracy
       FROM signature_requests WHERE document_id = ? ORDER BY created_at DESC`, [req.params.id]
  ) as any;
  res.json(rows);
});

export default router;
