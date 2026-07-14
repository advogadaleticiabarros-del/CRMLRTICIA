import fs from 'fs';
import path from 'path';
import { db } from './database';

/**
 * Aplica as migrations pendentes NO BOOT.
 *
 * HISTÓRIA DESTE ARQUIVO (para ninguém repetir o erro):
 * O deploy rodava `npm run migrate && npm start`. Quando uma migration tinha SQL
 * inválido, o `&&` impedia o `npm start` → o CRM ficava FORA DO AR. Para destravar,
 * o `migrate` foi removido do deploy — e aí as migrations pararam de rodar em
 * silêncio: a tabela `job_runs` simplesmente não existia em produção, e ninguém viu.
 *
 * Os dois extremos são ruins:
 *   - migration quebrada derruba o CRM inteiro → péssimo
 *   - migration não rodar em silêncio          → pior ainda
 *
 * Solução: rodar no boot, mas uma falha NÃO impede o servidor de subir. Ela é
 * registrada, gritada no log e avisada aos admins no sino. O CRM continua no ar,
 * e você FICA SABENDO.
 */

export interface ResultadoMigrations {
  aplicadas: string[];
  jaAplicadas: number;
  falha: { arquivo: string; erro: string } | null;
}

/**
 * Divide o arquivo em statements, com duas armadilhas resolvidas:
 *
 * 1. COMENTÁRIO INLINE COM ';'  — um `-- separadas por ';'` no meio de um
 *    CREATE TABLE fazia o split por ';' cortar o comando ao meio. A versão
 *    antiga só removia comentários em linhas que COMEÇAVAM com '--'.
 *    (Isso quebrou a migration 068 em produção.)
 *
 * 2. ';' DENTRO DE STRING — 'a; b' não pode ser tratado como fim de comando.
 *
 * Por isso não dá para usar split(';') puro: percorremos o texto respeitando
 * aspas. Assim nenhum comentário volta a derrubar um deploy.
 */
export function dividirStatements(sql: string): string[] {
  const out: string[] = [];
  let atual = '';
  let aspas: '"' | "'" | '`' | null = null;

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const prox = sql[i + 1];

    if (aspas) {
      atual += c;
      if (c === '\\') { if (prox !== undefined) { atual += prox; i++; } continue; } // escape
      if (c === aspas) aspas = null;
      continue;
    }

    // comentário `-- ...` FORA de aspas: descarta até o fim da linha
    if (c === '-' && prox === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      atual += '\n';
      continue;
    }
    // comentário /* ... */
    if (c === '/' && prox === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i++;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') { aspas = c as any; atual += c; continue; }

    if (c === ';') { const s = atual.trim(); if (s) out.push(s); atual = ''; continue; }

    atual += c;
  }

  const resto = atual.trim();
  if (resto) out.push(resto);
  return out;
}

export async function runMigrations(): Promise<ResultadoMigrations> {
  const dir = path.resolve(__dirname, '../../migrations');
  const aplicadas: string[] = [];

  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(255) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  const [applied] = await db.query('SELECT filename FROM schema_migrations') as any;
  const jaFeitas = new Set(applied.map((r: any) => r.filename));

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (jaFeitas.has(file)) continue;

    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const statements = dividirStatements(sql);

    const conn = await db.getConnection();
    try {
      for (const stmt of statements) await conn.query(stmt);
      await conn.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
      console.log(`✅ [migration] ${file} aplicada (${statements.length} statements)`);
      aplicadas.push(file);
    } catch (err: any) {
      const erro = err?.message || String(err);
      console.error(`❌ [migration] FALHA em ${file}: ${erro}`);
      conn.release();
      // Para na primeira falha: aplicar as seguintes sobre um schema inconsistente
      // é pior. Mas NÃO lança — o CRM precisa subir mesmo assim.
      return { aplicadas, jaAplicadas: jaFeitas.size, falha: { arquivo: file, erro } };
    }
    conn.release();
  }

  return { aplicadas, jaAplicadas: jaFeitas.size, falha: null };
}

/** Avisa os admins no sino que uma migration falhou (o schema está incompleto). */
export async function avisarFalhaMigration(arquivo: string, erro: string): Promise<void> {
  try {
    const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
    for (const a of admins) {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
         VALUES (?, ?, ?, 'migration_falhou', 'sistema', NOW(), 'pendente')`,
        [a.id,
         '🚨 Migration do banco FALHOU',
         `A migration "${arquivo}" não foi aplicada: ${erro}\n\n` +
         'O CRM está no ar, mas o banco pode estar incompleto — telas novas podem ' +
         'dar erro de "tabela não existe". Corrija o SQL e faça um novo deploy.']
      );
    }
  } catch { /* avisar é best-effort */ }
}
