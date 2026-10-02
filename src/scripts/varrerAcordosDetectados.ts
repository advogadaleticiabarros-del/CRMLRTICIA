/**
 * Varredura única dos últimos 180 dias de movimentações atrás de acordos
 * homologados/juntados que nunca viraram registro (relato 02/10/2026).
 * Uso na VPS: node dist/scripts/varrerAcordosDetectados.js
 */
import { varrerHistorico } from '../services/acordosDetectados';
import { db } from '../config/database';

varrerHistorico(180)
  .then((r) => { console.log(`Acordos detectados: ${r.encontrados}`); return db.end(); })
  .catch((e) => { console.error(e); process.exit(1); });
