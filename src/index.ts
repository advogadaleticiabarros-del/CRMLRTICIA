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

  // 2. Migrations pendentes. Uma falha NÃO derruba o CRM (antes, `migrate && start`
  //    deixava o sistema fora do ar por um SQL ruim — e a "solução" foi parar de
  //    migrar, o que fez a tabela job_runs simplesmente não existir em produção).
  try {
    const { runMigrations, avisarFalhaMigration } = await import('./config/migrations');
    const m = await runMigrations();
    if (m.aplicadas.length) console.log(`🗄️  ${m.aplicadas.length} migration(s) aplicada(s): ${m.aplicadas.join(', ')}`);
    else if (!m.falha) console.log(`🗄️  Banco em dia (${m.jaAplicadas} migrations aplicadas).`);
    if (m.falha) {
      console.error(
        `🚨 MIGRATION FALHOU: ${m.falha.arquivo}\n` +
        '    O CRM vai subir mesmo assim, mas o banco está INCOMPLETO.\n' +
        '    Telas novas podem dar "tabela não existe". Corrija o SQL e refaça o deploy.'
      );
      await avisarFalhaMigration(m.falha.arquivo, m.falha.erro);
    }
  } catch (e: any) {
    console.error('❌ Erro ao rodar as migrations (o CRM sobe mesmo assim):', e?.message);
  }

  // 3. LGPD: cifra os tokens de OAuth que ainda estiverem em texto puro.
  //    Idempotente e barato. Roda aqui para não exigir script manual contra o
  //    banco de produção. Falhar aqui NÃO pode impedir o CRM de subir.
  try {
    const { cifrarTokensEmRepouso } = await import('./services/tokenEncryption');
    const r = await cifrarTokensEmRepouso();
    if (r.cifrados > 0)   console.log(`🔐 LGPD: ${r.cifrados} token(s) cifrado(s) em repouso.`);
    if (r.recifrados > 0) console.log(`🔑 LGPD: ${r.recifrados} token(s) MIGRADO(S) da chave antiga para a ENCRYPTION_KEY. Gmail/Drive/Agenda seguem funcionando.`);
    if (r.cifrados === 0 && r.recifrados === 0 && r.jaCifrados > 0) {
      console.log(`🔐 LGPD: tokens cifrados e legíveis (${r.jaCifrados} campo(s)).`);
    }
    if (r.ilegiveis > 0) {
      console.error(
        `🚨 [LGPD] ${r.ilegiveis} token(s) NÃO abrem com nenhuma chave conhecida.\n` +
        '    A ENCRYPTION_KEY foi trocada sem migração. É preciso RECONECTAR as contas ' +
        '(Gmail da parceria, Google Agenda) em Configurações/Integrações.'
      );
    }
    if (r.erros.length) console.warn('⚠️  [LGPD] Tabelas não verificadas:', r.erros.join(' | '));
  } catch (e: any) {
    console.error('❌ [LGPD] Falha ao cifrar tokens em repouso (o CRM sobe mesmo assim):', e?.message);
  }

  // 4. Sobe o servidor HTTP
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`🚀 CRM Jurídico rodando em http://localhost:${env.PORT}`);
    console.log(`   Ambiente: ${env.NODE_ENV}`);
  });

  // 5. Inicia as rotinas automáticas (prazos, notificações, sync)
  startCronJobs();
  console.log('⏰ Cron jobs iniciados');

  // 6. Shutdown gracioso
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
