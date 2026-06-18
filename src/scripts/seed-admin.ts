import bcrypt from 'bcryptjs';
import { db, closeDatabase } from '../config/database';

/**
 * Cria o usuário admin inicial se ainda não existir nenhum admin.
 * Credenciais vêm de ADMIN_EMAIL / ADMIN_PASSWORD (env) ou usam o padrão de dev.
 * Idempotente: não recria se o e-mail já existir.
 */
async function run() {
  const email = process.env.ADMIN_EMAIL ?? 'admin@advogadaleticiabarros.com.br';
  const password = process.env.ADMIN_PASSWORD ?? 'MudarSenha@123';
  const name = process.env.ADMIN_NAME ?? 'Administrador';

  const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]) as any;
  if (existing.length) {
    console.log(`ℹ️  Admin já existe: ${email} (nada a fazer)`);
    await closeDatabase();
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  await db.query(
    'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
    [name, email, hash, 'admin']
  );

  console.log('✅ Admin criado com sucesso:');
  console.log(`   E-mail: ${email}`);
  console.log(`   Senha:  ${password}`);
  console.log('   ⚠️  Troque a senha no primeiro acesso (PATCH /api/auth/password).');

  await closeDatabase();
}

run().catch((err) => {
  console.error('Erro ao criar admin:', err.message);
  process.exit(1);
});
