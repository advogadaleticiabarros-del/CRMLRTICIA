import { db } from '../config/database';
import { PHASE_RANK } from '../utils/faseProcesso';

/**
 * A fase sugerida (lida das movimentações) nunca é aplicada sozinha e só
 * aparecia como selo na tela de Processos. Este aviso cobre quem não abre a
 * tela: quando a sugerida está À FRENTE da fase manual por 3+ dias, avisa os
 * admins (1 vez) e repete a cada 14 dias enquanto a divergência persistir.
 * Ideia 7 da auditoria de Processos e prazos (28/09/2026).
 * O "desde quando diverge" vem de uma marca em sent_reminders (1º dia visto).
 */
const ROTULO: Record<string, string> = {
  inicial: 'Inicial', instrucao: 'Instrução', sentenca: 'Sentença', recurso: 'Recurso', execucao: 'Execução', encerrado: 'Encerrado',
};

export async function alertarFaseDivergente(): Promise<{ divergentes: number; avisos: number }> {
  const [rows] = await db.query(
    `SELECT id, process_number, phase, suggested_phase FROM legal_processes
      WHERE suggested_phase IS NOT NULL AND status = 'ativo' AND monitoring_enabled = 1`
  ) as any;
  const divergentes = rows.filter((r: any) => (PHASE_RANK[r.suggested_phase] || 0) > (PHASE_RANK[r.phase] || 0));
  if (!divergentes.length) return { divergentes: 0, avisos: 0 };

  const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
  let avisos = 0;
  for (const p of divergentes) {
    const vistoKey = `fase_div_visto_${p.id}_${p.suggested_phase}`;
    const [ins] = await db.query('INSERT IGNORE INTO sent_reminders (ref_key, channel) VALUES (?, ?)', [vistoKey, 'sino']) as any;
    if (ins.affectedRows) continue; // 1ª vez que vimos: só marca o início da divergência
    const [[v]] = await db.query(
      'SELECT DATEDIFF(NOW(), created_at) AS dias FROM sent_reminders WHERE ref_key = ?', [vistoKey]) as any;
    const dias = Number(v?.dias) || 0;
    if (dias < 3) continue;
    const bucket = Math.floor(dias / 14);
    const [av] = await db.query(
      'INSERT IGNORE INTO sent_reminders (ref_key, channel) VALUES (?, ?)',
      [`fase_div_aviso_${p.id}_${p.suggested_phase}_${bucket}`, 'sino']) as any;
    if (!av.affectedRows) continue;
    for (const a of admins) {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
         VALUES (?, ?, ?, 'fase_divergente', 'sistema', NOW(), 'pendente')`,
        [a.id, `Fase do processo pode estar desatualizada`,
         `Processo ${p.process_number}: as movimentações indicam "${ROTULO[p.suggested_phase] || p.suggested_phase}", mas a fase cadastrada é "${ROTULO[p.phase] || p.phase}" (há ${dias} dia(s)). Abra Processos e confirme ou ajuste a fase.`]
      ).catch(() => {});
    }
    avisos++;
  }
  return { divergentes: divergentes.length, avisos };
}
