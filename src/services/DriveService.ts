import { google } from 'googleapis';
import { decrypt } from '../utils/crypto';
import { db } from '../config/database';
import { env } from '../config/env';

const drive = google.drive('v3');

function buildOAuth2Client() {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  );
}

/**
 * Cria uma pasta no Google Drive com nome inteligente: "ClientName - LegalArea - Description"
 * Se pasta com mesmo nome já existe, retorna dados da existente (idempotente)
 */
export async function createProductionFolder(
  userId: number,
  clientName: string,
  legalArea: string,
  description: string
): Promise<{ folderId: string; folderUrl: string } | null> {
  try {
    const folderName = `${clientName}${legalArea ? ` - ${legalArea}` : ''}${description ? ` - ${description}` : ''}`.trim();

    const auth = await getUserDriveAuth(userId);
    if (!auth) {
      console.warn(`[DriveService] Sem auth OAuth para user ${userId}; pulando criação de pasta`);
      return null;
    }

    // Busca pasta com mesmo nome (evita duplicar)
    const listRes = await drive.files.list({
      auth,
      q: `name='${folderName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      spaces: 'drive',
      fields: 'files(id, webViewLink)',
      pageSize: 1,
    });

    if (listRes.data.files && listRes.data.files.length > 0) {
      const file = listRes.data.files[0];
      console.log(`[DriveService] Pasta existente encontrada: "${folderName}" (${file.id})`);
      return { folderId: file.id!, folderUrl: file.webViewLink! };
    }

    // Cria nova pasta na raiz do Drive
    console.log(`[DriveService] Criando pasta: "${folderName}"`);
    const createRes = await drive.files.create({
      auth,
      requestBody: { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id, webViewLink',
    });

    if (!createRes.data.id) throw new Error('Falha ao criar pasta no Drive (sem ID retornado)');

    console.log(`[DriveService] ✓ Pasta criada: "${folderName}" (${createRes.data.id})`);
    return { folderId: createRes.data.id, folderUrl: createRes.data.webViewLink! };
  } catch (err) {
    console.error(`[DriveService] Erro ao criar pasta para "${clientName}":`, err);
    return null;
  }
}

/**
 * Obtém um OAuth2Client válido para Drive.
 * Tenta primeiro google_accounts (Calendar OAuth).
 * Fallback: email_integration (Partner inbox — tem drive.file scope).
 */
async function getUserDriveAuth(userId: number): Promise<any | null> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;

  // 1. Tenta google_accounts (Calendar OAuth)
  try {
    const [rows] = await db.query(
      'SELECT access_token, refresh_token FROM google_accounts WHERE user_id = ? LIMIT 1',
      [userId]
    ) as any;
    if (rows.length && rows[0].refresh_token) {
      const client = buildOAuth2Client();
      client.setCredentials({ access_token: decrypt(rows[0].access_token), refresh_token: decrypt(rows[0].refresh_token) });
      return client;
    }
  } catch (err) {
    console.warn(`[DriveService] Erro ao buscar token Calendar para user ${userId}:`, err);
  }

  // 2. Fallback: email_integration (parceria — tem drive.file scope)
  try {
    const [[row]] = await db.query(
      'SELECT access_token, refresh_token FROM email_integration WHERE id = 1 AND active = 1 AND refresh_token IS NOT NULL'
    ) as any;
    if (row?.refresh_token) {
      const client = buildOAuth2Client();
      client.setCredentials({ access_token: decrypt(row.access_token), refresh_token: decrypt(row.refresh_token) });
      return client;
    }
  } catch (err) {
    console.warn('[DriveService] Erro ao buscar token email_integration:', err);
  }

  return null;
}
