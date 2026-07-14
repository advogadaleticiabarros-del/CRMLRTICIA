import os from 'os';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import mysqldump from 'mysqldump';
import { env } from '../config/env';
import { encryptBuffer } from '../utils/crypto';

// megajs publica os tipos só via "exports"; sob moduleResolution "node" o TS não
// os resolve, então carregamos via require (tipado como any) para evitar TS7016.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Storage } = require('megajs');

const RETENTION = 30;            // mantém os últimos N backups no MEGA
const PREFIX = 'crm-backup-';

interface BackupResult { ok: boolean; file?: string; sizeKB?: number; message?: string; }

/** Abre a sessão MEGA e devolve a pasta de destino (por node id da URL, ou a raiz). */
async function openMega(): Promise<{ storage: any; folder: any } | null> {
  const email = process.env.MEGA_EMAIL;
  const password = process.env.MEGA_PASSWORD;
  if (!email || !password) return null;

  const storage = await new Storage({ email, password }).ready;
  const folderId = process.env.MEGA_FOLDER_ID;
  const folder = folderId && storage.files[folderId] ? storage.files[folderId] : storage.root;
  return { storage, folder };
}

/** Gera um dump comprimido do MySQL e envia para o MEGA. Mantém só os últimos RETENTION. */
export async function runBackup(): Promise<BackupResult> {
  const session = await openMega().catch((e) => { throw new Error('Falha ao logar no MEGA: ' + e.message); });
  if (!session) return { ok: false, message: 'MEGA_EMAIL/MEGA_PASSWORD não configurados' };
  const { storage, folder } = session;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); // 2026-06-22T18-30-00
  const cifrado = !!(process.env.ENCRYPTION_KEY || process.env.JWT_SECRET);
  // .enc no nome deixa explícito que o arquivo está cifrado (a restauração
  // detecta pelo conteúdo, não pelo nome — o sufixo é só para o humano).
  const filename = `${PREFIX}${stamp}.sql.gz${cifrado ? '.enc' : ''}`;
  const tmpPath = path.join(os.tmpdir(), `${PREFIX}${stamp}.sql`); // dump em SQL puro

  try {
    // 1. Dump lógico SEM a compressão do pacote (compressFile trava/quebra o stream).
    //    Geramos o .sql puro e comprimimos com zlib — confiável e rápido.
    await mysqldump({
      connection: {
        host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME,
        user: env.DB_USER, password: env.DB_PASSWORD,
      },
      dumpToFile: tmpPath,
    });

    // 2. LGPD: cifra o dump ANTES de sair daqui. O arquivo carrega CPF, laudos
    //    médicos e conversas — quem tiver as credenciais do MEGA não pode lê-lo.
    const buffer = encryptBuffer(zlib.gzipSync(fs.readFileSync(tmpPath)));

    // 3. Upload para o MEGA
    await folder.upload({ name: filename, size: buffer.length }, buffer).complete;

    // 3. Rotação — mantém só os RETENTION mais recentes (nome tem ISO date → ordena lexicograficamente)
    try {
      const backups = (folder.children || []).filter((f: any) => f.name && f.name.startsWith(PREFIX));
      backups.sort((a: any, b: any) => String(b.name).localeCompare(String(a.name)));
      for (const old of backups.slice(RETENTION)) await old.delete(true);
    } catch { /* rotação é best-effort */ }

    return { ok: true, file: filename, sizeKB: Math.round(buffer.length / 1024) };
  } finally {
    // O .sql temporário está em CLARO no disco — apagar sempre, mesmo se falhar.
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    try { await storage.close(); } catch { /* ignore */ }
  }
}

/** Lista os backups existentes na pasta do MEGA. */
export async function listBackups(): Promise<{ name: string; sizeKB: number }[]> {
  const session = await openMega();
  if (!session) return [];
  const { storage, folder } = session;
  try {
    return (folder.children || [])
      .filter((f: any) => f.name && f.name.startsWith(PREFIX))
      .sort((a: any, b: any) => String(b.name).localeCompare(String(a.name)))
      .map((f: any) => ({ name: f.name, sizeKB: Math.round((f.size || 0) / 1024) }));
  } finally {
    try { await storage.close(); } catch { /* ignore */ }
  }
}
