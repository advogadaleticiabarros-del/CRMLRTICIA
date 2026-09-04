import { db, closeDatabase } from '../config/database';
import { limparTextoJudicial } from '../services/textCleanup';

/**
 * Script AVULSO (roda uma vez, sob demanda) — backfill retroativo pra
 * limpeza de HTML bruto/entidades não decodificadas em `process_movements`.
 *
 * O commit que introduziu src/services/textCleanup.ts (limparTextoJudicial)
 * só limpa movimentações NOVAS a partir dali (ingestão em djen.ts e
 * courtEmailMonitorService.ts). Este script varre o que já estava salvo
 * antes disso e corrige.
 *
 * O que FAZ: pra cada linha de `process_movements`, aplica
 * limparTextoJudicial(description) e limparTextoJudicial(title); só
 * executa o UPDATE quando o texto limpo é DIFERENTE do original (não toca
 * em linhas que já estavam limpas — maioria dos casos).
 *
 * O que NÃO FAZ: não mexe em `ai_summary` (resumo já gerado pela IA) nem
 * dispara reprocessamento — o texto que a IA já resumiu não muda
 * retroativamente; só a exibição/uso futuro do texto bruto fica limpo.
 * Não manda WhatsApp, não recalcula nada de prazo/severidade.
 *
 * Uso (rodar manualmente, com acesso ao banco de produção):
 *   npx ts-node src/scripts/backfillLimparMovimentacoes.ts
 */

async function run(): Promise<void> {
  console.log('\n========================================');
  console.log('  Backfill: limpeza retroativa de movimentações (HTML/entidades)');
  console.log('========================================\n');

  const [rows] = await db.query(
    'SELECT id, title, description FROM process_movements'
  ) as any;
  console.log(`${rows.length} movimentação(ões) no total.\n`);

  let alteradas = 0;
  let inalteradas = 0;
  for (const r of rows) {
    const tituloLimpo = limparTextoJudicial(r.title);
    const descLimpa = limparTextoJudicial(r.description);
    if (tituloLimpo === (r.title || '') && descLimpa === (r.description || '')) {
      inalteradas++;
      continue;
    }
    await db.query(
      'UPDATE process_movements SET title = ?, description = ? WHERE id = ?',
      [tituloLimpo || null, descLimpa, r.id]
    );
    alteradas++;
    if (alteradas % 50 === 0) console.log(`  ... ${alteradas} corrigidas até agora`);
  }

  console.log('\n========================================');
  console.log('  RESUMO');
  console.log('========================================');
  console.log(`Movimentações corrigidas:   ${alteradas}`);
  console.log(`Já estavam limpas:          ${inalteradas}`);
  console.log('\nConcluído.\n');
}

run()
  .catch((err) => {
    console.error('Erro ao rodar o backfill:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
    process.exit(process.exitCode || 0);
  });
