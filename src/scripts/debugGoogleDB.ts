import { db } from '../config/database';

async function debug() {
  console.log('\n🔍 Debugando tabelas Google...\n');

  // Verifica estrutura da tabela
  const [cols] = await db.query("DESCRIBE google_accounts") as any;
  console.log('📋 Tabela google_accounts:');
  for (const col of cols) {
    console.log(`   ${col.Field}: ${col.Type} ${col.Null === 'NO' ? 'NOT NULL' : 'nullable'}`);
  }

  // Lista conteúdo
  console.log('\n📊 Conteúdo:');
  const [rows] = await db.query("SELECT user_id, google_email, sync_enabled FROM google_accounts") as any;
  if (rows.length) {
    console.log(rows);
  } else {
    console.log('   (vazio)');
  }

  // Verifica users
  console.log('\n👤 Usuários do sistema:');
  const [users] = await db.query("SELECT id, name, email, role FROM users LIMIT 5") as any;
  console.log(users);

  process.exit(0);
}

debug().catch(console.error);
