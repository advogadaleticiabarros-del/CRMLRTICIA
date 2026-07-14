import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  CORS_ORIGIN: z.string().default('http://localhost:3001'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET deve ter pelo menos 16 caracteres'),

  // LGPD — cifra dados sensíveis em repouso (tokens de OAuth do Gmail/Drive/Agenda).
  // Gere com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  // ⚠️ NUNCA perca esta chave: sem ela, os tokens cifrados não podem ser lidos
  // (basta reconectar as contas Google, mas dá trabalho).
  // Se ausente, o sistema deriva do JWT_SECRET e avisa no log.
  ENCRYPTION_KEY: z.string().optional(),

  // MySQL — DB_HOST/DB_PORT podem vir do Railway. Defaults para dev local.
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(3306),
  DB_NAME: z.string().default('crm_juridico'),
  DB_USER: z.string().default('root'),
  DB_PASSWORD: z.string().default(''),

  // Google Calendar (opcionais — recursos degradam graciosamente se ausentes)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),

  // Telegram (opcionais)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
});

// Railway expõe o MySQL como MYSQLHOST/MYSQLPORT/... — usamos como fallback
// para que o deploy funcione apenas adicionando o plugin MySQL, sem configurar DB_*.
const raw = {
  ...process.env,
  DB_HOST: process.env.DB_HOST ?? process.env.MYSQLHOST,
  DB_PORT: process.env.DB_PORT ?? process.env.MYSQLPORT,
  DB_NAME: process.env.DB_NAME ?? process.env.MYSQLDATABASE,
  DB_USER: process.env.DB_USER ?? process.env.MYSQLUSER,
  DB_PASSWORD: process.env.DB_PASSWORD ?? process.env.MYSQLPASSWORD,
};

const parsed = envSchema.safeParse(raw);

if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';
