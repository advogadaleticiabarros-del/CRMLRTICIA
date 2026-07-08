import { db } from '../config/database';

async function list() {
  const [clients] = await db.query('SELECT id, name FROM clients ORDER BY name ASC') as any;

  console.log('\n👥 TODOS OS CLIENTES:\n');
  for (const c of clients) {
    console.log(`  [${c.id}] ${c.name}`);
  }
  console.log(`\nTotal: ${clients.length}\n`);
  process.exit(0);
}

list().catch(err => { console.error(err); process.exit(1); });
