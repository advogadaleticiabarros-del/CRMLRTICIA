import mysql from 'mysql2/promise';
import { env } from './env';

/**
 * Pool de conexões MySQL compartilhado por toda a aplicação.
 * Importado como `db` pelos serviços e rotas: `import { db } from '../config/database'`.
 *
 * Uso: const [rows] = await db.query('SELECT ...', [params]);
 */
export const db = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: 'Z',
  dateStrings: false,
});

// Garante que a sessão MySQL use UTC, alinhando NOW()/CURDATE() com as datas
// gravadas em UTC (timezone 'Z'). Sem isso, NOW() usa o fuso do servidor e o
// despacho de notificações (scheduled_at <= NOW()) ficava defasado.
db.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'");
});

/** Verifica a conexão na inicialização. Lança erro se o banco estiver inacessível. */
export async function assertDatabaseConnection(): Promise<void> {
  const conn = await db.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}

/** Fecha o pool graciosamente (shutdown). */
export async function closeDatabase(): Promise<void> {
  await db.end();
}
