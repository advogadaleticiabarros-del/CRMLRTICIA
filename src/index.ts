import { createApp } from './app';
import { env } from './config/env';
import { assertDatabaseConnection, closeDatabase } from './config/database';
import { startCronJobs } from './crons';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Defesa em profundidade: nunca derruba o servidor por um erro não tratado de uma rota.
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
});

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

  // 2. LGPD: cifra os tokens de OAuth que ainda estiverem em texto puro.
  //    Idempotente e barato. Roda aqui para não exigir script manual contra o
  //    banco de produção. Falhar aqui NÃO pode impedir o CRM de subir.
  try {
    const { cifrarTokensEmRepouso } = await import('./services/tokenEncryption');
    const r = await cifrarTokensEmRepouso();
    if (r.cifrados > 0) {
      console.log(`🔐 LGPD: ${r.cifrados} token(s) de OAuth cifrado(s) em repouso.`);
    } else if (r.jaCifrados > 0) {
      console.log(`🔐 LGPD: tokens já cifrados (${r.jaCifrados} campo(s)).`);
    }
    if (r.erros.length) console.warn('⚠️  [LGPD] Tabelas não verificadas:', r.erros.join(' | '));
  } catch (e: any) {
    console.error('❌ [LGPD] Falha ao cifrar tokens em repouso (o CRM sobe mesmo assim):', e?.message);
  }

  // 3. Sobe o servidor HTTP
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`🚀 CRM Jurídico rodando em http://localhost:${env.PORT}`);
    console.log(`   Ambiente: ${env.NODE_ENV}`);
  });

  // 4. Inicia as rotinas automáticas (prazos, notificações, sync)
  startCronJobs();
  console.log('⏰ Cron jobs iniciados');

  // 5. Shutdown gracioso
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
