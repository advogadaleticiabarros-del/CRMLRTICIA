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

    // Remove linhas de comentário (-- ...) antes de dividir em statements.
    // Sem isso, um bloco que começa com comentário descartaria o CREATE TABLE seguinte.
    const cleaned = sql
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

    // Divide por ';' — seguro aqui pois nenhum statement contém ';' interno.
    const statements = cleaned
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const conn = await db.getConnection();
    try {
      // DDL no MySQL causa commit implícito; rodamos statement a statement
      // e registramos a migration só após todos terem sido aplicados.
      for (const stmt of statements) {
        await conn.query(stmt);
      }

      await conn.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
      console.log(`✅ ${file} aplicada (${statements.length} statements)`);
      count++;
    } catch (err) {
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
