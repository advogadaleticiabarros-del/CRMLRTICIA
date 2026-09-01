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

const RETENTION_MEGA = 30;        // mantém os últimos N backups no MEGA
const RETENTION_LOCAL = 14;       // mantém os últimos N backups na VPS (camada rápida de emergência)
const PREFIX = 'crm-backup-';

// Fora de ~/app: o deploy roda `git reset --hard origin/main` dentro de
// ~/app a cada push (.github/workflows/deploy.yml) — qualquer coisa salva
// ali seria apagada no próximo deploy. Este caminho sobrevive a isso.
export const LOCAL_BACKUP_DIR = path.join(os.homedir(), 'backups-crm');

export interface DestinoResultado {
  ok: boolean;
  file?: string;
  sizeKB?: number;
  message?: string;
}

export interface BackupMultiDestino {
  mega: DestinoResultado;
  local: DestinoResultado;
}

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

/**
 * Gera o dump lógico do MySQL, comprime e cifra — UM único dump por
 * execução, reaproveitado pelos dois destinos (evita dobrar a carga no
 * banco a cada backup). Sempre limpa o .sql temporário, mesmo se falhar.
 */
async function gerarDumpCifrado(stamp: string): Promise<{ buffer: Buffer; filename: string }> {
  const cifrado = !!(process.env.ENCRYPTION_KEY || process.env.JWT_SECRET);
  // .enc no nome deixa explícito que o arquivo está cifrado (a restauração
  // detecta pelo conteúdo, não pelo nome — o sufixo é só para o humano).
  const filename = `${PREFIX}${stamp}.sql.gz${cifrado ? '.enc' : ''}`;
  const tmpPath = path.join(os.tmpdir(), `${PREFIX}${stamp}.sql`);

  try {
    await mysqldump({
      connection: {
        host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME,
        user: env.DB_USER, password: env.DB_PASSWORD,
      },
      dumpToFile: tmpPath,
      // format:false na seção de dados — BUG da lib "mysqldump": ela embrulha
      // valores binários grandes (BLOB de PDF, mídia do WhatsApp) num marcador
      // interno NOFORMAT_WRAP("##...##") e desembrulha via regex DEPOIS de
      // formatar o SQL (deixar bonito/indentado); o formatador quebra linha
      // no meio de blobs grandes, o regex (sem função multilinha) não casa
      // mais, e o marcador cru vaza pro dump final — restauração falha com
      // "FUNCTION ... NOFORMAT_WRAP does not exist" (achado rodando a prova
      // mensal de restauração manualmente, 01/09/2026: todo backup com
      // documento/mídia grande estava, na prática, irrestaurável). Sem
      // formatação, o valor nunca é quebrado em várias linhas — bug nunca
      // aparece. Dump fica menos legível a olho nu, mas ninguém lê 60MB de
      // INSERT à mão; o que importa é restaurar.
      dump: { data: { format: false } },
    });

    // LGPD: cifra o dump ANTES de sair daqui. O arquivo carrega CPF, laudos
    // médicos e conversas — quem tiver acesso a qualquer um dos destinos não
    // pode lê-lo sem a ENCRYPTION_KEY.
    const buffer = encryptBuffer(zlib.gzipSync(fs.readFileSync(tmpPath)));
    return { buffer, filename };
  } finally {
    // O .sql temporário está em CLARO no disco — apagar sempre, mesmo se falhar.
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

/** Envia o dump para o MEGA e faz a rotação (mantém só os RETENTION_MEGA mais recentes). */
async function enviarParaMega(buffer: Buffer, filename: string): Promise<DestinoResultado> {
  let session: { storage: any; folder: any } | null = null;
  try {
    session = await openMega();
    if (!session) return { ok: false, message: 'MEGA_EMAIL/MEGA_PASSWORD não configurados' };
    const { folder } = session;

    await folder.upload({ name: filename, size: buffer.length }, buffer).complete;

    try {
      const backups = (folder.children || []).filter((f: any) => f.name && f.name.startsWith(PREFIX));
      backups.sort((a: any, b: any) => String(b.name).localeCompare(String(a.name)));
      for (const old of backups.slice(RETENTION_MEGA)) await old.delete(true);
    } catch { /* rotação é best-effort */ }

    return { ok: true, file: filename, sizeKB: Math.round(buffer.length / 1024) };
  } catch (e: any) {
    return { ok: false, message: 'Falha ao enviar para o MEGA: ' + (e?.message || String(e)) };
  } finally {
    try { if (session) await session.storage.close(); } catch { /* ignore */ }
  }
}

/** Grava o dump em ~/backups-crm e faz a rotação (mantém só os RETENTION_LOCAL mais recentes). */
async function enviarParaLocal(buffer: Buffer, filename: string): Promise<DestinoResultado> {
  try {
    fs.mkdirSync(LOCAL_BACKUP_DIR, { recursive: true });
    const destino = path.join(LOCAL_BACKUP_DIR, filename);
    fs.writeFileSync(destino, buffer);

    try {
      const arquivos = fs.readdirSync(LOCAL_BACKUP_DIR).filter((f) => f.startsWith(PREFIX));
      arquivos.sort((a, b) => b.localeCompare(a));
      for (const old of arquivos.slice(RETENTION_LOCAL)) {
        fs.unlinkSync(path.join(LOCAL_BACKUP_DIR, old));
      }
    } catch { /* rotação é best-effort */ }

    return { ok: true, file: filename, sizeKB: Math.round(buffer.length / 1024) };
  } catch (e: any) {
    return { ok: false, message: 'Falha ao gravar backup local: ' + (e?.message || String(e)) };
  }
}

/**
 * Gera um dump comprimido e cifrado do MySQL e envia para os DOIS destinos
 * (MEGA e disco local da VPS) de forma INDEPENDENTE — a falha de um nunca
 * impede a tentativa do outro. Quem chama decide o nível de alerta a partir
 * do resultado combinado (ver src/crons/index.ts, job 'backup:diario').
 */
export async function runBackup(): Promise<BackupMultiDestino> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); // 2026-06-22T18-30-00
  const { buffer, filename } = await gerarDumpCifrado(stamp);

  const [mega, local] = await Promise.all([
    enviarParaMega(buffer, filename),
    enviarParaLocal(buffer, filename),
  ]);

  return { mega, local };
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

/** Lista os backups existentes localmente (~/backups-crm), mais recente primeiro. */
export function listLocalBackups(): { name: string; sizeKB: number }[] {
  if (!fs.existsSync(LOCAL_BACKUP_DIR)) return [];
  return fs.readdirSync(LOCAL_BACKUP_DIR)
    .filter((f) => f.startsWith(PREFIX))
    .sort((a, b) => b.localeCompare(a))
    .map((f) => {
      const stat = fs.statSync(path.join(LOCAL_BACKUP_DIR, f));
      return { name: f, sizeKB: Math.round(stat.size / 1024) };
    });
}

/** Caminho absoluto do backup local mais recente, ou null se não houver nenhum. */
export function getLatestLocalBackupPath(): string | null {
  const backups = listLocalBackups();
  if (!backups.length) return null;
  return path.join(LOCAL_BACKUP_DIR, backups[0].name);
}
