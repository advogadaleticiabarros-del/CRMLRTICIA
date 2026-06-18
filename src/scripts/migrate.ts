import fs from 'fs';
import path from 'path';
import { db, closeDatabase } from '../config/database';

/**
 * Executa todas as migrations em /migrations na ordem alfabética (001_, 002_, ...).
 * Registra as já aplicadas em `schema_migrations` para não rodar duas vezes.
 */
async function run() {
  const migrationsDir = path.resolve(__dirname, '../../migrations');

  // Garante a tabela de controle
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(255) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  const [applied] = await db.query('SELECT filename FROM schema_migrations') as any;
  const appliedSet = new Set(applied.map((r: any) => r.filename));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`⏭️  ${file} (já aplicada)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      // mysql2 com multipleStatements desligado: divide em statements
      const statements = sql
        .split(/;\s*[\r\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('--'));

      for (const stmt of statements) {
        await conn.query(stmt);
      }

      await conn.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
      await conn.commit();
      console.log(`✅ ${file} aplicada`);
      count++;
    } catch (err) {
      await conn.rollback();
      console.error(`❌ Falha em ${file}:`, (err as Error).message);
      throw err;
    } finally {
      conn.release();
    }
  }

  console.log(count === 0 ? '\nNenhuma migration nova.' : `\n${count} migration(s) aplicada(s).`);
  await closeDatabase();
}

run().catch((err) => {
  console.error('Erro nas migrations:', err.message);
  process.exit(1);
});
