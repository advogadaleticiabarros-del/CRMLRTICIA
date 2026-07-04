import { db } from '../config/database';

async function check() {
  const [cases] = await db.query(
    "SELECT production_stage, COUNT(*) as total FROM cases WHERE production_stage IS NOT NULL GROUP BY production_stage"
  ) as any;

  console.log('\n📊 Casos por estágio:\n');
  for (const c of cases) {
    console.log(`  ${c.production_stage}: ${c.total}`);
  }

  // Também verifica quantos têm drive_folder_url
  const [all] = await db.query(
    "SELECT COUNT(*) as com_pasta, (SELECT COUNT(*) FROM cases WHERE production_stage IS NOT NULL AND drive_folder_url IS NULL) as sem_pasta FROM cases WHERE production_stage IS NOT NULL AND drive_folder_url IS NOT NULL"
  ) as any;

  console.log(`\n  Com pasta Drive: ${all[0]?.com_pasta || 0}`);
  console.log(`  Sem pasta Drive: ${all[0]?.sem_pasta || 0}\n`);

  process.exit(0);
}

check().catch(console.error);
