import { closeDatabase } from '../config/database';
import { cifrarTokensEmRepouso } from '../services/tokenEncryption';

/**
 * Cifra os tokens de OAuth em texto puro no banco.
 *
 * NÃO é mais necessário rodar isto: o CRM faz sozinho no boot (src/index.ts).
 * Este script fica como ferramenta manual, para diagnóstico.
 *
 * Uso: npx tsx src/scripts/encryptExistingTokens.ts
 */
async function main() {
  console.log('🔐 Cifrando tokens em repouso (LGPD)\n');
  const r = await cifrarTokensEmRepouso();
  console.log(`  cifrados agora : ${r.cifrados}`);
  console.log(`  já cifrados    : ${r.jaCifrados}`);
  if (r.erros.length) console.log(`  avisos         : ${r.erros.join(' | ')}`);
  console.log('\n✅ Concluído.');
  await closeDatabase();
}

main().catch(async (e) => { console.error('❌', e); await closeDatabase(); process.exit(1); });
