import { closeDatabase } from '../config/database';
import { runMigrations } from '../config/migrations';

/**
 * `npm run migrate` (deploy e CI): aplica as migrations pendentes com o MESMO
 * executor do boot (`config/migrations.ts`), que divide os comandos respeitando
 * aspas e comentários.
 * Até 16/10/2026 este script tinha a própria cópia, com split(';') ingênuo: a
 * migration 127 (COMMENT com ';' dentro do texto) quebrava num banco novo. Em
 * produção não aparecia porque o boot aplicava antes. O CI que monta o banco do
 * zero achou. Diferente do boot, aqui uma falha sai com código 1 (trava o CI).
 */
async function run() {
  const r = await runMigrations();
  if (r.aplicadas.length) console.log(`\n${r.aplicadas.length} migration(s) aplicada(s).`);
  else console.log(`\nNenhuma migration nova (${r.jaAplicadas} já aplicadas).`);
  await closeDatabase();
  if (r.falha) {
    console.error(`Erro nas migrations: ${r.falha.arquivo}: ${r.falha.erro}`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Erro nas migrations:', err.message);
  process.exit(1);
});
