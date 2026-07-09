import { google } from 'googleapis';
import { Readable } from 'stream';
import { db } from '../config/database';
import { env } from '../config/env';
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
    [email, tokens.access_token || null, tokens.refresh_token || null,
     tokens.expiry_date ? new Date(tokens.expiry_date) : null]
  );
}

async function loadIntegration(): Promise<any> {
  const [[row]] = await db.query('SELECT * FROM email_integration WHERE id = 1') as any;
  return row || null;
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
        [t.access_token, t.expiry_date ? new Date(t.expiry_date) : null]);
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
function walkParts(payload: any, texts: string[], atts: any[], seenIds = new Set<string>()): void {
  if (!payload) return;
  const parts = payload.parts || [];
  if (payload.filename && payload.body?.attachmentId && !seenIds.has(payload.body.attachmentId)) {
    seenIds.add(payload.body.attachmentId);
    atts.push({ filename: payload.filename, mimeType: payload.mimeType, attachmentId: payload.body.attachmentId });
  }
  if (payload.mimeType === 'text/plain' && payload.body?.data) texts.push(decodeB64(payload.body.data));
  else if (payload.mimeType === 'text/html' && payload.body?.data && !texts.length) {
    texts.push(decodeB64(payload.body.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  }
  for (const p of parts) walkParts(p, texts, atts, seenIds);
}

/** Busca e-mails novos do remetente e enfileira na revisão. Retorna quantos entraram. */
export async function syncInboxNow(actorId?: number | null, opts?: { resetSync?: boolean }): Promise<{ imported: number; skipped: number }> {
  const row = await loadIntegration();
  if (!row || !row.refresh_token || !row.active) return { imported: 0, skipped: 0 };

  // Se resetSync, apaga last_sync para que a busca comece do início do dia atual
  if (opts?.resetSync) {
    await db.query('UPDATE email_integration SET last_sync = NULL WHERE id = 1');
    row.last_sync = null;
  }

  const auth = await authedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  // Ponto de partida: a partir do último sync; na PRIMEIRA vez, a partir de
  // HOJE (00:00 de Brasília) — não puxa histórico antigo.
  const sinceSec = row.last_sync
    ? Math.floor(new Date(row.last_sync).getTime() / 1000)
    : startOfTodayBrazilSec();
  const q = `from:${row.sender_filter} after:${sinceSec}`;
  let imported = 0, skipped = 0;
  const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: 25 });
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

/**
 * Baixa os anexos de uma importação (source gmail) e sobe pro Drive, criando
 * um documento (file_url) por anexo, vinculado ao cliente/caso.
 */
export async function processAttachmentsForImport(importId: number, clientId: number, caseId: number | null, actorId: number): Promise<number> {
  const [[imp]] = await db.query('SELECT source, source_message_id, attachments_json FROM email_imports WHERE id = ?', [importId]) as any;
  if (!imp || imp.source !== 'gmail' || !imp.source_message_id || !imp.attachments_json) return 0;
  let atts: any[] = [];
  try { atts = typeof imp.attachments_json === 'string' ? JSON.parse(imp.attachments_json) : imp.attachments_json; } catch {}
  if (!Array.isArray(atts) || !atts.length) return 0;

  const auth = await authedClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });
  // Pasta exclusiva do caso: Raiz → Cliente → Caso.
  const folderId = await ensureCaseFolder(auth, clientId, caseId);

  let n = 0;
  for (const a of atts) {
    try {
      const data = await gmail.users.messages.attachments.get({ userId: 'me', messageId: imp.source_message_id, id: a.attachmentId });
      const buf = Buffer.from((data.data.data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
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
      n++;
    } catch { /* um anexo com erro não trava os demais */ }
  }
  return n;
}
