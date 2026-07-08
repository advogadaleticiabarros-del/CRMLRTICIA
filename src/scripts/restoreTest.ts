import { runRestoreCheckAndNotify } from '../services/restoreService';
import { closeDatabase } from '../config/database';

/**
 * Prova real do backup: baixa o último dump do MEGA e restaura num banco
 * temporário. Uso: npm run restore:test
 */
runRestoreCheckAndNotify()
  .then(async (r) => {
    if (r.ok) console.log(`\n✅ BACKUP CONFIÁVEL — ${r.file}\n   ${r.tabelas} tabelas · ${r.clientes} clientes · ${r.casos} casos · ${r.usuarios} usuários\n`);
    else console.error(`\n❌ BACKUP COM PROBLEMA — ${r.message}\n`);
    await closeDatabase();
    process.exit(r.ok ? 0 : 1);
  })
  .catch(async (e) => { console.error('Erro:', e.message); await closeDatabase(); process.exit(1); });
