import { createApp } from './app';
import { env } from './config/env';
import { assertDatabaseConnection, closeDatabase } from './config/database';
import { startCronJobs } from './crons';

async function bootstrap() {
  // 1. Valida conexão com o banco antes de subir o servidor
  try {
    await assertDatabaseConnection();
    console.log('✅ MySQL conectado');
  } catch (err) {
    console.error('❌ Falha ao conectar ao MySQL:', (err as Error).message);
    console.error('   Verifique DB_HOST/DB_PORT/DB_USER/DB_PASSWORD no .env');
    process.exit(1);
  }

  // 2. Sobe o servidor HTTP
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`🚀 CRM Jurídico rodando em http://localhost:${env.PORT}`);
    console.log(`   Ambiente: ${env.NODE_ENV}`);
  });

  // 3. Inicia as rotinas automáticas (prazos, notificações, sync)
  startCronJobs();
  console.log('⏰ Cron jobs iniciados');

  // 4. Shutdown gracioso
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} recebido — encerrando...`);
    server.close(async () => {
      await closeDatabase();
      console.log('✅ Encerrado com segurança');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('Erro fatal no bootstrap:', err);
  process.exit(1);
});
