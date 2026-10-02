/**
 * Liga as tarefas "Analisar …" antigas ao prazo detectado e fecha as que já
 * foram resolvidas (análise 02/10/2026). Uso: node dist/scripts/sanearTarefasAnalisar.js
 */
import { sanearTarefasAnalisar } from '../services/tarefasPrazoDetectado';
import { db } from '../config/database';

sanearTarefasAnalisar()
  .then((r) => { console.log(`Tarefas ligadas: ${r.ligadas} · fechadas: ${r.fechadas}`); return db.end(); })
  .catch((e) => { console.error(e); process.exit(1); });
