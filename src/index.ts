import { createApp } from './app';
import { env } from './config/env';
import { assertDatabaseConnection, closeDatabase } from './config/database';
import { startCronJobs } from './crons';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bootstrap() {
  // 1. Valida conexão com o banco (com retry — o MySQL pode demorar a ficar pronto no deploy)
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await assertDatabaseConnection();
      console.log('✅ MySQL conectado');
      break;
    } catch (err) {
      if (attempt === maxAttempts) {
        console.error('❌ Falha ao conectar ao MySQL após', maxAttempts, 'tentativas:', (err as Error).message);
        console.error('   Verifique DB_HOST/DB_PORT/DB_USER/DB_PASSWORD (ou o plugin MySQL do Railway)');
        process.exit(1);
      }
      console.log(`⏳ MySQL ainda não disponível (tentativa ${attempt}/${maxAttempts})…`);
      await sleep(3000);
    }
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
