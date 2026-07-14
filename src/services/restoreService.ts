import zlib from 'zlib';
import mysql from 'mysql2/promise';
import { env } from '../config/env';
import { db } from '../config/database';
import { decryptBuffer, isEncryptedBuffer } from '../utils/crypto';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Storage } = require('megajs');

const PREFIX = 'crm-backup-';
const TEST_DB = 'crm_restore_test';

export interface RestoreReport {
  ok: boolean;
  file?: string;
  tabelas?: number;
  clientes?: number;
  casos?: number;
  usuarios?: number;
  message?: string;
}

/**
 * PROVA REAL do backup: baixa o dump mais recente do MEGA, restaura num banco
 * temporário (crm_restore_test), confere as tabelas-chave e apaga o temporário.
 * Backup que não restaura não é backup — este teste roda todo mês (cron) e
 * pode ser disparado na mão: npm run restore:test
 */
export async function verifyLatestBackup(): Promise<RestoreReport> {
  const email = process.env.MEGA_EMAIL;
  const password = process.env.MEGA_PASSWORD;
  if (!email || !password) return { ok: false, message: 'MEGA_EMAIL/MEGA_PASSWORD não configurados' };

  let storage: any = null;
  let conn: mysql.Connection | null = null;
  try {
    // 1. Localiza o backup mais recente no MEGA
    storage = await new Storage({ email, password }).ready;
    const folderId = process.env.MEGA_FOLDER_ID;
    const folder = folderId && storage.files[folderId] ? storage.files[folderId] : storage.root;
    const backups = (folder.children || [])
      .filter((f: any) => f.name && f.name.startsWith(PREFIX))
      .sort((a: any, b: any) => String(b.name).localeCompare(String(a.name)));
    if (!backups.length) return { ok: false, message: 'Nenhum backup encontrado no MEGA' };

    const latest = backups[0];

    // 2. Baixa, DECIFRA (se preciso) e descomprime.
    //    A detecção é pelo CONTEÚDO (assinatura no início do arquivo), não pelo
    //    nome — assim os backups antigos, gravados em claro, continuam restaurando.
    const bruto: Buffer = await latest.downloadBuffer();
    const cifrado = isEncryptedBuffer(bruto);
    let gz: Buffer;
    try {
      gz = decryptBuffer(bruto);
    } catch (e: any) {
      return { ok: false, file: latest.name, message: `Backup cifrado e não foi possível decifrar: ${e?.message}. A ENCRYPTION_KEY mudou?` };
    }
    const sql = zlib.gunzipSync(gz).toString('utf8');
    if (!sql.includes('CREATE TABLE')) return { ok: false, file: latest.name, message: 'Dump sem CREATE TABLE — arquivo corrompido?' };
    console.log(`   Backup ${cifrado ? 'CIFRADO' : 'em claro (antigo)'}: ${latest.name}`);

    // 3. Restaura num banco temporário isolado
    conn = await mysql.createConnection({
      host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD,
      multipleStatements: true,
    });
    await conn.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await conn.query(`CREATE DATABASE ${TEST_DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`USE ${TEST_DB}`);
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    await conn.query(sql);
    await conn.query('SET FOREIGN_KEY_CHECKS=1');

    // 4. Prova real: tabelas e linhas-chave existem?
    const [[t]]: any = await conn.query(
      'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?', [TEST_DB]);
    const contar = async (tabela: string): Promise<number> => {
      try { const [[r]]: any = await conn!.query(`SELECT COUNT(*) AS n FROM ${TEST_DB}.${tabela}`); return Number(r.n); }
      catch { return -1; }
    };
    const report: RestoreReport = {
      ok: true, file: latest.name, tabelas: Number(t.n),
      clientes: await contar('clients'), casos: await contar('cases'), usuarios: await contar('users'),
    };
    if (report.tabelas! < 10 || report.usuarios! < 1) {
      report.ok = false;
      report.message = 'Restauração incompleta (poucas tabelas ou sem usuários)';
    }
    return report;
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Falha na restauração' };
  } finally {
    try { if (conn) { await conn.query(`DROP DATABASE IF EXISTS ${TEST_DB}`); await conn.end(); } } catch { /* ignore */ }
    try { if (storage) await storage.close(); } catch { /* ignore */ }
  }
}

/** Roda o teste e avisa os admins no sino (sucesso silencioso, falha alerta). */
export async function runRestoreCheckAndNotify(): Promise<RestoreReport> {
  const r = await verifyLatestBackup();
  if (r.ok) {
    console.log(`✅ Prova do backup OK: ${r.file} → ${r.tabelas} tabelas · ${r.clientes} clientes · ${r.casos} casos.`);
  } else {
    console.error(`❌ Prova do backup FALHOU: ${r.message || ''} (${r.file || 'sem arquivo'})`);
    try {
      const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
      for (const a of admins) {
        await db.query(
          `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
           VALUES (?, ?, ?, 'backup_falha', 'sistema', NOW(), 'pendente')`,
          [a.id, 'Teste de restauração do backup FALHOU',
           `A prova mensal do backup falhou: ${r.message || 'erro desconhecido'}. Verifique o MEGA e o backup diário.`]
        );
      }
    } catch { /* best-effort */ }
  }
  return r;
}
