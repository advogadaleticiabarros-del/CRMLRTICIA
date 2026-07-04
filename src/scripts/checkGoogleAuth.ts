import { db } from '../config/database';

async function check() {
  const [accounts] = await db.query(
    "SELECT user_id, google_email, access_token IS NOT NULL as tem_token FROM google_accounts"
  ) as any;

  console.log('\n📧 Contas Google configuradas:\n');
  if (!accounts.length) {
    console.log('  ❌ Nenhuma conta Google configurada no DB\n');
    console.log('  Para criar pastas Drive automaticamente:');
    console.log('  1. Vá para Configurações no CRM');
    console.log('  2. Clique em "Conectar Google Drive"');
    console.log('  3. Autorize o acesso');
    console.log('  4. Execute novamente: npm run create:drive-folders\n');
  } else {
    for (const acc of accounts) {
      console.log(`  User ${acc.user_id}: ${acc.google_email} ${acc.tem_token ? '✅' : '❌'}`);
    }
    console.log();
  }

  process.exit(0);
}

check().catch(console.error);
