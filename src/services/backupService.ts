import os from 'os';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import mysqldump from 'mysqldump';
import { env } from '../config/env';
import { promisify } from 'util';
import { Readable } from 'stream';
import { encryptBuffer, decryptBuffer, isEncryptedBuffer } from '../utils/crypto';
import { planoRetencao, RETENCAO_MEGA, RETENCAO_LOCAL } from './backupRegras';

const gzipAsync = promisify(zlib.gzip);

// megajs publica os tipos só via "exports"; sob moduleResolution "node" o TS não
// os resolve, então carregamos via require (tipado como any) para evitar TS7016.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Storage } = require('megajs');

// Retenção (07/10/2026): avô-pai-filho, ver backupRegras.planoRetencao —
// MEGA: tudo dos últimos 3 dias + 1 por dia até 30 dias + 1 por mês até 12 meses;
// VPS: tudo dos últimos 3 dias + 1 por dia até 14 dias (camada rápida de emergência).
const PREFIX = 'crm-backup-';

// Tempo limite de cada etapa. Antes não havia: em 16/09 e 05/10/2026 o backup
// travou no meio, sem arquivo e sem erro — ninguém soube. Agora, travou, vira
// erro (alerta) e a recuperação automática tenta de novo.
const LIMITE_DUMP_MS = 25 * 60_000;
const LIMITE_MEGA_MS = 25 * 60_000;

function comTempoLimite<T>(p: Promise<T>, ms: number, etapa: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`${etapa} passou de ${Math.round(ms / 60000)} min (travou)`)), ms); }),
  ]);
}

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

export interface VerificacaoBackup { ok: boolean; tabelas: number; mbSql: number; message?: string }

export interface BackupMultiDestino {
  mega: DestinoResultado;
  local: DestinoResultado;
  verificacao: VerificacaoBackup;
}

// Enquanto existe, um backup está em andamento — o deploy espera (deploy.yml)
// em vez de reiniciar o sistema no meio da cópia.
export const ARQUIVO_TRAVA = path.join(LOCAL_BACKUP_DIR, '.backup-em-andamento');

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
    await comTempoLimite(mysqldump({
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
    }), LIMITE_DUMP_MS, 'Geração da cópia do banco');

    // LGPD: cifra o dump ANTES de sair daqui. O arquivo carrega CPF, laudos
    // médicos e conversas — quem tiver acesso a qualquer um dos destinos não
    // pode lê-lo sem a ENCRYPTION_KEY.
    // gzip assíncrono: o síncrono travava o sistema inteiro por vários segundos.
    const buffer = encryptBuffer(await gzipAsync(await fs.promises.readFile(tmpPath)));
    return { buffer, filename };
  } finally {
    // O .sql temporário está em CLARO no disco — apagar sempre, mesmo se falhar.
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

/**
 * Confere o arquivo ANTES de mandá-lo para os destinos e antes de apagar
 * cópias antigas: decifra, descomprime de ponta a ponta (o gzip valida o CRC)
 * e confere que o dump tem as tabelas principais. Lê em fluxo — não monta o
 * SQL inteiro na memória.
 */
export async function verificarBackup(buffer: Buffer): Promise<VerificacaoBackup> {
  try {
    const gz = isEncryptedBuffer(buffer) ? decryptBuffer(buffer) : buffer;
    const tabelas = new Set<string>();
    let bytes = 0; let resto = '';
    const re = /CREATE TABLE[^`]*`([^`]+)`/g;
    for await (const chunk of Readable.from([gz]).pipe(zlib.createGunzip())) {
      bytes += chunk.length;
      const txt = resto + chunk.toString('latin1');
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(txt))) tabelas.add(m[1]);
      resto = txt.slice(-200);
    }
    const faltando = ['clients', 'cases', 'legal_processes', 'financial_records', 'documents'].filter((t) => !tabelas.has(t));
    const mbSql = Math.round(bytes / 1048576);
    if (faltando.length) return { ok: false, tabelas: tabelas.size, mbSql, message: `Cópia incompleta: faltam as tabelas ${faltando.join(', ')}` };
    if (tabelas.size < 50) return { ok: false, tabelas: tabelas.size, mbSql, message: `Cópia com só ${tabelas.size} tabelas — esperado mais de 50` };
    return { ok: true, tabelas: tabelas.size, mbSql };
  } catch (e: any) {
    return { ok: false, tabelas: 0, mbSql: 0, message: 'Arquivo de backup não abre: ' + (e?.message || String(e)) };
  }
}

/** Envia o dump para o MEGA, confere o tamanho lá e faz a rotação (backupRegras). */
async function enviarParaMega(buffer: Buffer, filename: string): Promise<DestinoResultado> {
  let session: { storage: any; folder: any } | null = null;
  try {
    session = await openMega();
    if (!session) return { ok: false, message: 'MEGA_EMAIL/MEGA_PASSWORD não configurados' };
    const { folder } = session;

    const enviado: any = await comTempoLimite(folder.upload({ name: filename, size: buffer.length }, buffer).complete, LIMITE_MEGA_MS, 'Envio ao MEGA');
    if (enviado && enviado.size != null && Number(enviado.size) !== buffer.length) {
      return { ok: false, message: `Arquivo chegou ao MEGA com tamanho diferente (${enviado.size} de ${buffer.length} bytes)` };
    }

    // Rotação só depois do envio conferido — nunca apaga cópia antiga sem a nova estar lá.
    try {
      const nomes = (folder.children || []).map((f: any) => f.name).filter((n: string) => n && n.startsWith(PREFIX));
      const { apagar } = planoRetencao(nomes, new Date(), RETENCAO_MEGA);
      for (const f of (folder.children || []).filter((x: any) => apagar.includes(x.name))) await f.delete(true);
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
    await fs.promises.writeFile(destino, buffer);
    if (fs.statSync(destino).size !== buffer.length) return { ok: false, message: 'Arquivo local gravado com tamanho diferente' };

    try {
      const arquivos = fs.readdirSync(LOCAL_BACKUP_DIR).filter((f) => f.startsWith(PREFIX));
      const { apagar } = planoRetencao(arquivos, new Date(), RETENCAO_LOCAL);
      for (const old of apagar) fs.unlinkSync(path.join(LOCAL_BACKUP_DIR, old));
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
  fs.mkdirSync(LOCAL_BACKUP_DIR, { recursive: true });
  fs.writeFileSync(ARQUIVO_TRAVA, new Date().toISOString());
  try {
    const { buffer, filename } = await gerarDumpCifrado(stamp);

    // Arquivo com defeito não vai para lugar nenhum (e não empurra cópias boas para fora da rotação).
    const verificacao = await verificarBackup(buffer);
    if (!verificacao.ok) throw new Error(`Cópia gerada com defeito, não foi salva: ${verificacao.message}`);

    const [mega, local] = await Promise.all([
      enviarParaMega(buffer, filename),
      enviarParaLocal(buffer, filename),
    ]);
    return { mega, local, verificacao };
  } finally {
    try { fs.unlinkSync(ARQUIVO_TRAVA); } catch { /* ignore */ }
  }
}

/** Resumo do MEGA para o aviso diário: quantas cópias, a mais antiga e % do espaço usado. */
export async function resumoMega(): Promise<{ copias: number; maisAntiga: string | null; usoPct: number | null }> {
  const session = await openMega();
  if (!session) return { copias: 0, maisAntiga: null, usoPct: null };
  const { storage, folder } = session;
  try {
    const nomes = (folder.children || []).map((f: any) => String(f.name)).filter((n: string) => n.startsWith(PREFIX)).sort();
    let usoPct: number | null = null;
    try { const i = await storage.getAccountInfo(); usoPct = i.spaceTotal ? Math.round((i.spaceUsed / i.spaceTotal) * 100) : null; } catch { /* sem cota */ }
    return { copias: nomes.length, maisAntiga: nomes[0] || null, usoPct };
  } finally {
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
