import { google } from 'googleapis';
import { Readable } from 'stream';
import { db } from '../config/database';
import { env } from '../config/env';
import { encrypt, decryptFields } from '../utils/crypto';
import { enqueueIntake } from './emailIntake';

/**
 * Fase 2 da importação por e-mail: robô que lê o Gmail que RECEBE os e-mails do
 * parceiro (conta única em email_integration, id=1), joga cada mensagem nova na
 * fila de revisão (idempotente por messageId) e, na confirmação, baixa os
 * anexos e sobe pro Google Drive (documents.file_url).
 *
 * Escopos: gmail.readonly (ler) + drive.file (subir anexos). O usuário conecta
 * a conta uma vez pelo botão "Conectar Gmail da parceria".
 */

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];
const DRIVE_ROOT_NAME = 'CRM Jurídico - Anexos';

function oauth() {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
}

export function getInboxAuthUrl(state: string): string {
  return oauth().generateAuthUrl({ access_type: 'offline', prompt: 'consent', state, scope: SCOPES });
}

/** Troca o code por tokens e salva na integração (id=1). */
export async function saveInboxTokens(code: string): Promise<void> {
  const client = oauth();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  let email: string | null = null;
  try { const { data } = await google.oauth2({ version: 'v2', auth: client }).userinfo.get(); email = data.email || null; } catch {}
  await db.query(
    `INSERT INTO email_integration (id, google_email, access_token, refresh_token, token_expiry, active)
     VALUES (1, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE google_email = VALUES(google_email), access_token = VALUES(access_token),
       refresh_token = COALESCE(VALUES(refresh_token), refresh_token), token_expiry = VALUES(token_expiry), active = 1`,
    // LGPD: tokens cifrados em repouso — dão acesso ao Gmail/Drive com dados de clientes.
    [email, encrypt(tokens.access_token || null), encrypt(tokens.refresh_token || null),
     tokens.expiry_date ? new Date(tokens.expiry_date) : null]
  );
}

/** Único ponto de leitura da integração — decifra os tokens aqui. */
async function loadIntegration(): Promise<any> {
  const [[row]] = await db.query('SELECT * FROM email_integration WHERE id = 1') as any;
  return decryptFields(row || null, ['access_token', 'refresh_token']);
}

/** Cliente OAuth autenticado com os tokens salvos (auto-refresh persistido). */
async function authedClient(): Promise<any> {
  const row = await loadIntegration();
  if (!row || !row.refresh_token) throw new Error('Gmail da parceria não conectado');
  const client = oauth();
  client.setCredentials({
    access_token: row.access_token, refresh_token: row.refresh_token,
    expiry_date: row.token_expiry ? new Date(row.token_expiry).getTime() : undefined,
  });
  client.on('tokens', async (t) => {
    if (t.access_token) {
      await db.query('UPDATE email_integration SET access_token = ?, token_expiry = ? WHERE id = 1',
        [encrypt(t.access_token), t.expiry_date ? new Date(t.expiry_date) : null]);
    }
  });
  return client;
}

export async function getInboxStatus(): Promise<any> {
  const row = await loadIntegration();
  if (!row) return { connected: false };
  return { connected: !!row.refresh_token, google_email: row.google_email, sender_filter: row.sender_filter,
    active: !!row.active, last_sync: row.last_sync };
}

export async function updateInboxConfig(opts: { sender_filter?: string; active?: boolean }): Promise<void> {
  const fields: string[] = []; const params: any[] = [];
  if (opts.sender_filter !== undefined) { fields.push('sender_filter = ?'); params.push(opts.sender_filter); }
  if (opts.active !== undefined) { fields.push('active = ?'); params.push(opts.active ? 1 : 0); }
  if (!fields.length) return;
  await db.query(`UPDATE email_integration SET ${fields.join(', ')} WHERE id = 1`, params);
}

export async function disconnectInbox(): Promise<void> {
  await db.query('UPDATE email_integration SET active = 0, access_token = NULL, refresh_token = NULL WHERE id = 1');
}

/** Epoch (segundos) da meia-noite de HOJE em Brasília (UTC-3 fixo, sem DST). */
function startOfTodayBrazilSec(): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  // Meia-noite em Brasília (UTC-3) = 03:00 UTC do mesmo dia.
  return Math.floor(Date.UTC(get('year'), get('month') - 1, get('day'), 3, 0, 0) / 1000);
}

// ── Extração de corpo e anexos de uma mensagem Gmail ────────────────────────
function decodeB64(data?: string | null): string {
  if (!data) return '';
  try { return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { return ''; }
}
/** Extrai o valor de um header MIME da parte (case-insensitive). */
function headerVal(payload: any, name: string): string | null {
  const h = (payload?.headers || []).find((x: any) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value || null;
}
/** Deriva um nome de arquivo a partir de Content-Disposition/Content-Type quando payload.filename vem vazio. */
function deriveFilename(payload: any, idx: number): string {
  if (payload.filename) return payload.filename;
  const cd = headerVal(payload, 'content-disposition') || '';
  const ct = headerVal(payload, 'content-type') || '';
  const m = cd.match(/filename\*?=(?:"([^"]+)"|([^;]+))/i) || ct.match(/name\*?=(?:"([^"]+)"|([^;]+))/i);
  if (m) return (m[1] || m[2] || '').trim();
  const ext = (payload.mimeType || '').split('/')[1] || 'bin';
  return `anexo_${idx}.${ext}`;
}

/** Descreve cada parte da árvore MIME (diagnóstico) — 1 linha por parte, indentada por profundidade. */
function describeParts(payload: any, out: string[], depth = 0): void {
  if (!payload || out.length > 60) return;
  const cd = headerVal(payload, 'content-disposition') || '';
  const disp = (cd.split(';')[0] || '').trim();
  out.push(
    `${'  '.repeat(depth)}${payload.mimeType || '?'}` +
    `${payload.filename ? ` file="${payload.filename}"` : ''}` +
    `${disp ? ` disp=${disp}` : ''}` +
    `${headerVal(payload, 'content-id') ? ' cid' : ''}` +
    `${payload.body?.attachmentId ? ' [attId]' : ''}` +
    `${payload.body?.data ? ' [data]' : ''}` +
    `${payload.body?.size ? ` ${payload.body.size}b` : ''}`
  );
  for (const p of payload.parts || []) describeParts(p, out, depth + 1);
}

/**
 * Percorre a árvore MIME coletando TODAS as partes que são arquivo, incluindo
 * imagens INLINE (Content-Disposition: inline / Content-ID) que o Outlook embute
 * no corpo — que apareciam com o ícone de nuvem e antes eram ignoradas.
 * Cada anexo vem com attachmentId (baixar via API) OU data (bytes inline).
 */
function walkParts(payload: any, texts: string[], atts: any[], seenIds = new Set<string>()): void {
  if (!payload) return;
  const parts = payload.parts || [];
  const mime = payload.mimeType || '';
  const isContainer = mime.startsWith('multipart/');
  const isBodyText = (mime === 'text/plain' || mime === 'text/html') && !payload.filename && !headerVal(payload, 'content-id');

  // Qualquer parte não-container e não-corpo com conteúdo (attachmentId ou data) é um arquivo.
  if (!isContainer && !isBodyText) {
    const attachmentId: string | undefined = payload.body?.attachmentId || undefined;
    const inlineData: string | undefined = !attachmentId ? (payload.body?.data || undefined) : undefined;
    if (attachmentId || inlineData) {
      const key = attachmentId || `inline:${payload.partId || atts.length}`;
      if (!seenIds.has(key)) {
        seenIds.add(key);
        atts.push({
          filename: deriveFilename(payload, atts.length + 1),
          mimeType: mime || 'application/octet-stream',
          attachmentId, data: inlineData,
        });
      }
    }
  }

  if (mime === 'text/plain' && payload.body?.data && !payload.filename) texts.push(decodeB64(payload.body.data));
  else if (mime === 'text/html' && payload.body?.data && !texts.length && !payload.filename) {
    texts.push(decodeB64(payload.body.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  }
  for (const p of parts) walkParts(p, texts, atts, seenIds);
}

/** Retorna o HTML BRUTO (com tags) do corpo — para extrair links de anexos de nuvem. */
function extractHtmlBody(payload: any): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/html' && payload.body?.data && !payload.filename) return decodeB64(payload.body.data);
  for (const p of payload.parts || []) {
    const h = extractHtmlBody(p);
    if (h) return h;
  }
  return '';
}

/**
 * Extrai links de arquivos hospedados em nuvem (OneDrive/SharePoint/Google Drive)
 * colados no corpo do e-mail — o Outlook manda anexos grandes assim (ícone de
 * nuvem no Gmail), e eles NÃO existem na árvore MIME.
 */
function extractCloudLinks(html: string): { url: string; filename: string }[] {
  const out: { url: string; filename: string }[] = [];
  const seen = new Set<string>();
  const re = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = m[1].replace(/&amp;/g, '&').trim();
    if (!/1drv\.ms|onedrive\.live\.com|onedrive\.com|sharepoint\.com|drive\.google\.com|docs\.google\.com/i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const fn = text.match(/[\w\-.() ]+\.(pdf|jpe?g|png|docx?|xlsx?|zip|heic)/i);
    out.push({ url, filename: fn ? fn[0].trim() : '' });
  }
  return out;
}

/** Baixa um arquivo de um link de nuvem público, tentando estratégias por provedor. Retorna os bytes. */
async function downloadCloudFile(url: string): Promise<{ buffer: Buffer; filename?: string; mimeType?: string } | null> {
  const tries: string[] = [];
  if (/1drv\.ms|onedrive\.live\.com|onedrive\.com/i.test(url)) {
    const b64 = Buffer.from(url).toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
    tries.push(`https://api.onedrive.com/v1.0/shares/u!${b64}/root/content`);
  }
  if (/sharepoint\.com/i.test(url)) tries.push(url + (url.includes('?') ? '&' : '?') + 'download=1');
  if (/drive\.google\.com/i.test(url)) {
    const idm = url.match(/[-\w]{25,}/);
    if (idm) tries.push(`https://drive.google.com/uc?export=download&id=${idm[0]}`);
  }
  tries.push(url); // último recurso: segue redirects do link original
  for (const t of tries) {
    try {
      const resp = await fetch(t, { redirect: 'follow' as any });
      if (!resp.ok) continue;
      const ct = resp.headers.get('content-type') || '';
      if (/text\/html/i.test(ct)) continue; // veio uma página, não o arquivo
      const buffer = Buffer.from(await resp.arrayBuffer());
      if (buffer.length < 100) continue;
      let filename: string | undefined;
      const cd = resp.headers.get('content-disposition') || '';
      const fm = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
      if (fm) { try { filename = decodeURIComponent(fm[1]); } catch { filename = fm[1]; } }
      return { buffer, filename, mimeType: ct.split(';')[0] || undefined };
    } catch { /* tenta a próxima estratégia */ }
  }
  return null;
}

/** Busca e-mails novos do remetente e enfileira na revisão. Retorna quantos entraram. */
export async function syncInboxNow(
  actorId?: number | null,
  opts?: { resetSync?: boolean; sinceDays?: number }
): Promise<{ imported: number; skipped: number }> {
  const row = await loadIntegration();
  if (!row || !row.refresh_token || !row.active) return { imported: 0, skipped: 0 };

  // Se resetSync, apaga last_sync para que a busca comece do início do dia atual
  if (opts?.resetSync) {
    await db.query('UPDATE email_integration SET last_sync = NULL WHERE id = 1');
    row.last_sync = null;
  }

  const auth = await authedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  // Ponto de partida:
  //  - sinceDays: força a busca a voltar N dias (para recuperar e-mails ANTIGOS
  //    que o parceiro mandou antes do último sync — ex.: caso chegado dia 01/07).
  //  - senão: a partir do último sync; na primeira vez, do início de HOJE.
  const sinceSec = opts?.sinceDays
    ? Math.floor(Date.now() / 1000) - opts.sinceDays * 86400
    : (row.last_sync
        ? Math.floor(new Date(row.last_sync).getTime() / 1000)
        : startOfTodayBrazilSec());
  const q = `from:${row.sender_filter} after:${sinceSec}`;
  let imported = 0, skipped = 0;
  // Busca antiga pode trazer mais mensagens — amplia o teto quando é retroativa.
  const maxResults = opts?.sinceDays ? 100 : 25;
  const list = await gmail.users.messages.list({ userId: 'me', q, maxResults });
  for (const m of list.data.messages || []) {
    const [[exists]] = await db.query('SELECT id FROM email_imports WHERE source_message_id = ?', [m.id]) as any;
    if (exists) { skipped++; continue; }
    const full = await gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'full' });
    const headers = full.data.payload?.headers || [];
    const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || null;
    const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value || row.sender_filter;
    const texts: string[] = []; const atts: any[] = [];
    walkParts(full.data.payload, texts, atts);
    const body = texts.join('\n').trim() || full.data.snippet || '';
    await enqueueIntake({
      rawText: body, source: 'gmail', sourceMessageId: m.id, fromEmail: from, subject,
      attachments: atts, createdBy: actorId || null,
    });
    imported++;
  }
  await db.query('UPDATE email_integration SET last_sync = NOW() WHERE id = 1');
  return { imported, skipped };
}

// ── Drive: pasta raiz + upload ──────────────────────────────────────────────
async function ensureRootFolder(auth: any): Promise<string> {
  const row = await loadIntegration();
  if (row?.drive_folder_id) return row.drive_folder_id;
  const drive = google.drive({ version: 'v3', auth });
  const found = await drive.files.list({ q: `name='${DRIVE_ROOT_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`, fields: 'files(id)' });
  let id = found.data.files?.[0]?.id;
  if (!id) {
    const created = await drive.files.create({ requestBody: { name: DRIVE_ROOT_NAME, mimeType: 'application/vnd.google-apps.folder' }, fields: 'id' });
    id = created.data.id!;
  }
  await db.query('UPDATE email_integration SET drive_folder_id = ? WHERE id = 1', [id]);
  return id!;
}

/** Extrai o fileId de uma URL do Drive (/d/<id>/ ou ?id=<id>). */
export function driveFileId(url: string): string | null {
  if (!url) return null;
  const m = String(url).match(/\/d\/([^/]+)/) || String(url).match(/[?&]id=([^&]+)/);
  return m ? m[1] : null;
}

/** Extrai o ID de uma pasta a partir do link do Drive (/folders/<id> ou ?id=). */
export function driveFolderId(url: string): string | null {
  if (!url) return null;
  const m = String(url).match(/\/folders\/([^/?]+)/) || String(url).match(/[?&]id=([^&]+)/);
  return m ? m[1] : (/^[A-Za-z0-9_-]{20,}$/.test(url.trim()) ? url.trim() : null);
}

/** Lista os arquivos (não-pastas) dentro de uma pasta do Drive. */
export async function listDriveFolderFiles(folderId: string): Promise<{ id: string; name: string; mimeType: string }[]> {
  try {
    const auth = await authedClient();
    const drive = google.drive({ version: 'v3', auth });
    const out: any[] = [];
    let pageToken: string | undefined;
    do {
      const r = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'`,
        fields: 'nextPageToken, files(id, name, mimeType)', pageSize: 100, pageToken,
      });
      for (const f of r.data.files || []) out.push(f);
      pageToken = r.data.nextPageToken || undefined;
    } while (pageToken && out.length < 200);
    return out;
  } catch { return []; }
}

/** Baixa os bytes de um arquivo do Drive (base64) + mimeType. Para análise por IA. */
export async function downloadDriveFile(fileId: string): Promise<{ base64: string; mimeType: string; name: string } | null> {
  try {
    const auth = await authedClient();
    const drive = google.drive({ version: 'v3', auth });
    const meta = await drive.files.get({ fileId, fields: 'mimeType, name, size' });
    const media = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
    const buf = Buffer.from(media.data as ArrayBuffer);
    return { base64: buf.toString('base64'), mimeType: meta.data.mimeType || 'application/octet-stream', name: meta.data.name || '' };
  } catch { return null; }
}

/** Acha (ou cria) uma subpasta com o nome dado dentro de um pai. */
async function ensureSubfolder(auth: any, parentId: string, name: string): Promise<string> {
  const drive = google.drive({ version: 'v3', auth });
  const safe = (name || 'Sem nome').replace(/'/g, "\\'").replace(/[\n\r]/g, ' ').slice(0, 120);
  const found = await drive.files.list({
    q: `name='${safe}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });
  let id = found.data.files?.[0]?.id;
  if (!id) {
    const created = await drive.files.create({
      requestBody: { name: safe, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      fields: 'id',
    });
    id = created.data.id!;
  }
  return id!;
}

/** Caminho no Drive: Raiz → Cliente → Caso. Cada caso tem sua pasta exclusiva. */
async function ensureCaseFolder(auth: any, clientId: number, caseId: number | null): Promise<string> {
  const rootId = await ensureRootFolder(auth);
  const [[cl]] = await db.query('SELECT name FROM clients WHERE id = ?', [clientId]) as any;
  const clientFolder = await ensureSubfolder(auth, rootId, cl?.name || `Cliente ${clientId}`);
  if (!caseId) return clientFolder;
  const [[cs]] = await db.query('SELECT title, case_number FROM cases WHERE id = ?', [caseId]) as any;
  const caseName = `Caso ${caseId}${cs?.case_number ? ' - ' + cs.case_number : (cs?.title ? ' - ' + cs.title : '')}`;
  return ensureSubfolder(auth, clientFolder, caseName);
}

/** Cria (ou localiza) a pasta do caso dentro de "CRM Jurídico - Anexos" e retorna o webViewLink. */
export async function getOrCreateCaseFolderUrl(clientId: number, caseId: number): Promise<string | null> {
  try {
    const auth = await authedClient();
    const folderId = await ensureCaseFolder(auth, clientId, caseId);
    const drive = google.drive({ version: 'v3', auth });
    const meta = await drive.files.get({ fileId: folderId, fields: 'webViewLink' });
    return meta.data.webViewLink || `https://drive.google.com/drive/folders/${folderId}`;
  } catch (e) {
    console.error('[getOrCreateCaseFolderUrl]', e);
    return null;
  }
}

/**
 * Nomes de arquivo já baixados para este caso — no banco (documents) E na pasta
 * do Drive. Usado para NÃO duplicar anexos quando "Baixar do e-mail" roda de novo.
 * Retorna um Set de nomes em minúsculas (comparação case-insensitive).
 */
async function existingAttachmentNames(auth: any, folderId: string, clientId: number, caseId: number | null): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const [docs] = await db.query(
      'SELECT name FROM documents WHERE (case_id = ? OR (case_id IS NULL AND client_id = ?))',
      [caseId, clientId]
    ) as any;
    for (const d of docs) if (d.name) set.add(String(d.name).trim().toLowerCase());
  } catch {}
  try {
    const drive = google.drive({ version: 'v3', auth });
    let pageToken: string | undefined;
    do {
      const r = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'nextPageToken, files(name)', pageSize: 100, pageToken,
      });
      for (const f of r.data.files || []) if (f.name) set.add(String(f.name).trim().toLowerCase());
      pageToken = r.data.nextPageToken || undefined;
    } while (pageToken);
  } catch {}
  return set;
}

/**
 * Baixa os anexos de uma importação (source gmail) e sobe pro Drive, criando
 * um documento (file_url) por anexo, vinculado ao cliente/caso.
 * Se attachments_json for nulo, rebusca o e-mail completo do Gmail como fallback.
 */
export async function processAttachmentsForImport(importId: number, clientId: number, caseId: number | null, actorId: number): Promise<number> {
  const [[imp]] = await db.query('SELECT source, source_message_id, attachments_json FROM email_imports WHERE id = ?', [importId]) as any;
  if (!imp || imp.source !== 'gmail' || !imp.source_message_id) return 0;

  const auth = await authedClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });

  let atts: any[] = [];
  if (imp.attachments_json) {
    try { atts = typeof imp.attachments_json === 'string' ? JSON.parse(imp.attachments_json) : imp.attachments_json; } catch {}
  }

  // Fallback: se não tiver metadados de anexo, rebusca o e-mail inteiro no Gmail
  if (!Array.isArray(atts) || !atts.length) {
    try {
      const msg = await gmail.users.messages.get({ userId: 'me', id: imp.source_message_id, format: 'full' });
      const texts: string[] = [], freshAtts: any[] = [];
      walkParts(msg.data.payload, texts, freshAtts);
      atts = freshAtts;
      if (atts.length) {
        await db.query('UPDATE email_imports SET attachments_json = ? WHERE id = ?', [JSON.stringify(atts), importId]);
      }
    } catch (e) {
      console.error('[processAttachmentsForImport] fallback gmail.get falhou:', e);
      return 0;
    }
  }

  if (!atts.length) return 0;

  const folderId = await ensureCaseFolder(auth, clientId, caseId);
  const jaBaixados = await existingAttachmentNames(auth, folderId, clientId, caseId);

  let n = 0;
  for (const a of atts) {
    try {
      if (a.filename && jaBaixados.has(String(a.filename).trim().toLowerCase())) continue; // já existe, não duplica
      let raw = a.data as string | undefined;
      if (!raw && a.attachmentId) {
        const data = await gmail.users.messages.attachments.get({ userId: 'me', messageId: imp.source_message_id, id: a.attachmentId });
        raw = data.data.data || '';
      }
      if (!raw) continue;
      const buf = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      const up = await drive.files.create({
        requestBody: { name: a.filename, parents: [folderId] },
        media: { mimeType: a.mimeType || 'application/octet-stream', body: Readable.from(buf) },
        fields: 'id, webViewLink',
      });
      const url = up.data.webViewLink || `https://drive.google.com/file/d/${up.data.id}/view`;
      await db.query(
        `INSERT INTO documents (client_id, case_id, name, type, folder, file_url, status, created_by)
         VALUES (?, ?, ?, 'anexo', 'processos', ?, 'recebido', ?)`,
        [clientId, caseId, a.filename, url, actorId]
      );
      if (a.filename) jaBaixados.add(String(a.filename).trim().toLowerCase());
      n++;
    } catch (e) {
      console.error('[processAttachmentsForImport] erro no anexo', a?.filename, e instanceof Error ? e.message : e);
    }
  }
  return n;
}

/**
 * Busca DIRETO no Gmail (sem depender de email_imports) os e-mails do parceiro
 * que mencionam o cliente e baixa os anexos pro Drive. Usado no botão retroativo
 * "Baixar do e-mail" para casos confirmados quando o OAuth estava expirado, ou
 * cujo vínculo com o import se perdeu. Retorna diagnóstico detalhado.
 */
export async function downloadClientAttachmentsFromGmail(
  clientId: number, caseId: number | null, actorId: number
): Promise<{ anexos: number; emails: number; query: string; assuntos: string[]; encontrados: number; pulados: number; arvore?: string[]; cloudLinks?: number; cloudFalhos?: string[]; erro?: string }> {
  const row = await loadIntegration();
  if (!row || !row.refresh_token) {
    return { anexos: 0, emails: 0, query: '', assuntos: [], encontrados: 0, pulados: 0, erro: 'Gmail da parceria não conectado' };
  }
  const [[cl]] = await db.query('SELECT name FROM clients WHERE id = ?', [clientId]) as any;
  const nome = String(cl?.name || '').trim();
  if (!nome) return { anexos: 0, emails: 0, query: '', assuntos: [], encontrados: 0, pulados: 0, erro: 'Cliente sem nome' };

  const auth = await authedClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });

  // Gmail full-text: e-mails do parceiro que mencionam o nome do cliente, com anexo.
  const sender = row.sender_filter ? `from:${row.sender_filter} ` : '';
  const query = `${sender}"${nome}" has:attachment`;
  let list;
  try {
    list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 10 });
  } catch (e: any) {
    return { anexos: 0, emails: 0, query, assuntos: [], encontrados: 0, pulados: 0, erro: e?.message || 'Falha ao listar no Gmail' };
  }

  const msgs = list.data.messages || [];
  if (!msgs.length) {
    // Fallback: sem "has:attachment" (alguns e-mails encaminhados escondem o flag)
    try {
      const alt = await gmail.users.messages.list({ userId: 'me', q: `${sender}"${nome}"`, maxResults: 10 });
      for (const m of alt.data.messages || []) msgs.push(m);
    } catch {}
  }
  if (!msgs.length) return { anexos: 0, emails: 0, query, assuntos: [], encontrados: 0, pulados: 0 };

  const folderId = await ensureCaseFolder(auth, clientId, caseId);
  const jaBaixados = await existingAttachmentNames(auth, folderId, clientId, caseId);
  let anexos = 0, encontrados = 0, pulados = 0, cloudLinks = 0; const assuntos: string[] = []; const arvore: string[] = []; const cloudFalhos: string[] = [];

  for (const m of msgs) {
    try {
      const full = await gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'full' });
      const headers = full.data.payload?.headers || [];
      const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || '(sem assunto)';
      assuntos.push(subject);
      const texts: string[] = []; const atts: any[] = [];
      walkParts(full.data.payload, texts, atts);
      if (arvore.length < 40) describeParts(full.data.payload, arvore); // dump p/ diagnóstico
      encontrados += atts.length;
      for (const a of atts) {
        try {
          if (a.filename && jaBaixados.has(String(a.filename).trim().toLowerCase())) { pulados++; continue; } // já existe
          let raw = a.data as string | undefined;
          if (!raw && a.attachmentId) {
            const data = await gmail.users.messages.attachments.get({ userId: 'me', messageId: m.id!, id: a.attachmentId });
            raw = data.data.data || '';
          }
          if (!raw) continue;
          const buf = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
          const up = await drive.files.create({
            requestBody: { name: a.filename, parents: [folderId] },
            media: { mimeType: a.mimeType || 'application/octet-stream', body: Readable.from(buf) },
            fields: 'id, webViewLink',
          });
          const url = up.data.webViewLink || `https://drive.google.com/file/d/${up.data.id}/view`;
          await db.query(
            `INSERT INTO documents (client_id, case_id, name, type, folder, file_url, status, created_by)
             VALUES (?, ?, ?, 'anexo', 'processos', ?, 'recebido', ?)`,
            [clientId, caseId, a.filename, url, actorId]
          );
          if (a.filename) jaBaixados.add(String(a.filename).trim().toLowerCase());
          anexos++;
        } catch (e) {
          console.error('[downloadClientAttachmentsFromGmail] anexo', a?.filename, e instanceof Error ? e.message : e);
        }
      }

      // Anexos de NUVEM (OneDrive/SharePoint/Drive) colados no corpo — não estão na árvore MIME.
      const html = extractHtmlBody(full.data.payload);
      const links = extractCloudLinks(html);
      for (const lk of links) {
        cloudLinks++;
        try {
          const nomeGuess = (lk.filename || '').trim().toLowerCase();
          if (nomeGuess && jaBaixados.has(nomeGuess)) { pulados++; continue; }
          const dl = await downloadCloudFile(lk.url);
          if (!dl) { cloudFalhos.push(lk.filename || lk.url); continue; }
          const finalName = lk.filename || dl.filename || `anexo_nuvem_${anexos + 1}.bin`;
          if (jaBaixados.has(finalName.trim().toLowerCase())) { pulados++; continue; }
          const up = await drive.files.create({
            requestBody: { name: finalName, parents: [folderId] },
            media: { mimeType: dl.mimeType || 'application/octet-stream', body: Readable.from(dl.buffer) },
            fields: 'id, webViewLink',
          });
          const url = up.data.webViewLink || `https://drive.google.com/file/d/${up.data.id}/view`;
          await db.query(
            `INSERT INTO documents (client_id, case_id, name, type, folder, file_url, status, created_by)
             VALUES (?, ?, ?, 'anexo', 'processos', ?, 'recebido', ?)`,
            [clientId, caseId, finalName, url, actorId]
          );
          jaBaixados.add(finalName.trim().toLowerCase());
          anexos++;
        } catch (e) {
          console.error('[downloadClientAttachmentsFromGmail] link nuvem', lk.url, e instanceof Error ? e.message : e);
          cloudFalhos.push(lk.filename || lk.url);
        }
      }
    } catch (e) {
      console.error('[downloadClientAttachmentsFromGmail] msg', m.id, e instanceof Error ? e.message : e);
    }
  }
  return { anexos, emails: msgs.length, query, assuntos, encontrados, pulados, arvore, cloudLinks, cloudFalhos };
}
