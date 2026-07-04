import { google } from 'googleapis';
import { db } from '../config/database';

const drive = google.drive('v3');

/**
 * Cria uma pasta no Google Drive com nome inteligente: "ClientName - LegalArea - Description"
 * Se pasta com mesmo nome já existe, retorna dados da existente (idempotente)
 * Requer: auth token do user (obtido via Google OAuth)
 */
export async function createProductionFolder(
  userId: number,
  clientName: string,
  legalArea: string,
  description: string
): Promise<{ folderId: string; folderUrl: string } | null> {
  try {
    // Monta nome da pasta
    const folderName = `${clientName}${legalArea ? ` - ${legalArea}` : ''}${description ? ` - ${description}` : ''}`.trim();

    // Obtém token OAuth do user (assumption: já existe em DB ou sessão)
    const auth = await getUserDriveAuth(userId);
    if (!auth) {
      console.warn(`[DriveService] Sem auth para user ${userId}; pulando criação de pasta`);
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
      return {
        folderId: file.id!,
        folderUrl: file.webViewLink!,
      };
    }

    // Cria nova pasta na raiz do Drive
    console.log(`[DriveService] Criando pasta: "${folderName}"`);
    const createRes = await drive.files.create({
      auth,
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id, webViewLink',
    });

    if (!createRes.data.id) {
      throw new Error('Falha ao criar pasta no Drive (sem ID retornado)');
    }

    console.log(`[DriveService] ✓ Pasta criada: "${folderName}" (${createRes.data.id})`);
    return {
      folderId: createRes.data.id,
      folderUrl: createRes.data.webViewLink!,
    };
  } catch (err) {
    console.error(`[DriveService] Erro ao criar pasta para "${clientName}":`, err);
    return null;
  }
}

/**
 * Obtém token de auth OAuth do user para acessar Google Drive
 * Busca na tabela google_accounts (preenchida pelo oauth callback)
 */
async function getUserDriveAuth(userId: number): Promise<any | null> {
  try {
    const [rows] = await db.query(
      'SELECT access_token, refresh_token FROM google_accounts WHERE user_id = ? LIMIT 1',
      [userId]
    ) as any;

    if (rows.length && rows[0].access_token) {
      return { credentials: { access_token: rows[0].access_token, refresh_token: rows[0].refresh_token } };
    }
  } catch (err) {
    console.warn(`[DriveService] Erro ao buscar token Google para user ${userId}:`, err);
  }
  return null;
}
