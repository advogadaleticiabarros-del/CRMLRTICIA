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
  const [rows] = await db.query('SELECT id, name, category, content, instructions, applies_to, legal_basis, updated_at FROM document_templates ORDER BY category, name') as any;
  res.json(rows);
});

router.post('/templates', async (req: Request, res: Response) => {
  const { name, category, content } = req.body;
  if (!name || !content) { res.status(400).json({ error: 'Nome e conteúdo são obrigatórios' }); return; }
  const [r] = await db.query(
    'INSERT INTO document_templates (name, category, content, created_by) VALUES (?, ?, ?, ?)',
    [name.trim(), category || 'outros', content, req.user!.id]
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
  const { template_id, client_id, case_id } = req.body;
  if (!template_id || !client_id) { res.status(400).json({ error: 'template_id e client_id são obrigatórios' }); return; }

  const [[tpl]] = await db.query('SELECT * FROM document_templates WHERE id = ?', [template_id]) as any;
  if (!tpl) { res.status(404).json({ error: 'Modelo não encontrado' }); return; }
  const [[client]] = await db.query('SELECT * FROM clients WHERE id = ?', [client_id]) as any;
  if (!client) { res.status(404).json({ error: 'Cliente não encontrado' }); return; }

  let proc: any = null;
  if (case_id) { const [[c]] = await db.query('SELECT * FROM cases WHERE id = ?', [case_id]) as any; proc = c; }
  const [[lawyer]] = await db.query("SELECT name, oab_number, oab_uf FROM lawyers WHERE active = 1 ORDER BY id LIMIT 1") as any;

  const map: Record<string, string> = {
    cliente_nome: client.name || '',
    cliente_cpf: client.cpf_cnpj || '',
    cliente_rg: client.rg || '',
    cliente_endereco: client.address || '',
    cliente_cidade: client.city || '',
    cliente_estado: client.state || '',
    cliente_profissao: client.profession || '',
    cliente_estado_civil: client.marital_status || '',
    processo_numero: proc ? (proc.case_number || proc.process_number || '') : '',
    advogada_nome: lawyer?.name || '',
    advogada_oab: lawyer ? `${lawyer.oab_number || ''}${lawyer.oab_uf ? '/' + lawyer.oab_uf : ''}` : '',
    data_extenso: dataExtenso(),
  };
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
            (d.content IS NOT NULL) AS has_content, d.created_at, c.name AS client_name
       FROM documents d LEFT JOIN clients c ON c.id = d.client_id
      WHERE ${where.join(' AND ')} ORDER BY d.created_at DESC LIMIT 500`, params
  ) as any;
  res.json(rows);
});

router.get('/:id', async (req: Request, res: Response) => {
  const [rows] = await db.query('SELECT * FROM documents WHERE id = ?', [req.params.id]) as any;
  if (!rows.length) { res.status(404).json({ error: 'Documento não encontrado' }); return; }
  res.json(rows[0]);
});

router.post('/', async (req: Request, res: Response) => {
  const { client_id, case_id, name, folder, type, file_url, status, content } = req.body;
  if (!client_id) { res.status(400).json({ error: 'client_id é obrigatório' }); return; }
  if (!name || !String(name).trim()) { res.status(400).json({ error: 'O nome é obrigatório' }); return; }
  const [r] = await db.query(
    `INSERT INTO documents (client_id, case_id, name, type, folder, file_url, content, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [client_id, case_id ?? null, name.trim(), type ?? null,
     FOLDERS.includes(folder) ? folder : 'outros', file_url ?? null, content ?? null,
     STATUSES.includes(status) ? status : 'recebido', req.user!.id]
  ) as any;
  const [rows] = await db.query('SELECT * FROM documents WHERE id = ?', [r.insertId]) as any;
  res.status(201).json(rows[0]);
});

router.put('/:id', async (req: Request, res: Response) => {
  const fields: string[] = []; const params: any[] = [];
  const setIf = (c: string, v: any, valid = true) => { if (v !== undefined && valid) { fields.push(`${c} = ?`); params.push(v); } };
  setIf('name', req.body.name?.trim?.());
  setIf('folder', req.body.folder, FOLDERS.includes(req.body.folder));
  setIf('status', req.body.status, STATUSES.includes(req.body.status));
  setIf('content', req.body.content);
  setIf('file_url', req.body.file_url);
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
  await db.query(
    `INSERT INTO signature_requests (document_id, token, verification_code, signer_name, signer_cpf, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [req.params.id, token, code, req.body?.signer_name ?? null, req.body?.signer_cpf ?? null, req.user!.id]
  );
  res.status(201).json({ token, verification_code: code, path: `/assinar.html?token=${token}` });
});

router.get('/:id/signatures', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT id, token, verification_code, signer_name, signer_cpf, status, signed_at, signer_ip
       FROM signature_requests WHERE document_id = ? ORDER BY created_at DESC`, [req.params.id]
  ) as any;
  res.json(rows);
});

export default router;
