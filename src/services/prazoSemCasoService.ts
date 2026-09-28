import { db } from '../config/database';
import { nivelUrgencia, diasAte } from '../utils/urgenciaPrazo';

/**
 * Prazo confirmado em processo monitorado SEM caso vinculado não entra na lista
 * de Prazos nem nos avisos 30/15/7/3/1 (que dependem de deadlines.case_id).
 * Achado da auditoria de Processos e prazos (28/09/2026). Este alerta diário
 * cobre o buraco: um aviso por prazo por dia, cada vez mais forte conforme o
 * vencimento se aproxima, até alguém vincular o processo a um caso (aí o prazo
 * passa a existir em `deadlines` e deixa de aparecer aqui, pois o processo
 * ganha case_id).
 */
const TITULO: Record<string, string> = {
  critico: '🚨 URGENTE',
  alto: '🚨 Prazo em poucos dias',
  atencao: '⚠️ Prazo na próxima semana',
  normal: 'Prazo sem processo vinculado',
};

export async function alertarPrazosSemCaso(): Promise<{ prazos: number; avisos: number }> {
  const [rows] = await db.query(
    `SELECT dd.id, dd.deadline_type, DATE_FORMAT(dd.due_date, '%Y-%m-%d') AS due, lp.process_number,
            DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoje
       FROM detected_deadlines dd
       JOIN legal_processes lp ON lp.id = dd.process_id
      WHERE dd.status = 'confirmado' AND lp.case_id IS NULL
        AND dd.due_date >= CURDATE() AND dd.due_date <= CURDATE() + INTERVAL 30 DAY
      ORDER BY dd.due_date ASC`
  ) as any;
  if (!rows.length) return { prazos: 0, avisos: 0 };

  const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
  let avisos = 0;
  for (const r of rows) {
    const dias = diasAte(r.due, r.hoje);
    const nivel = nivelUrgencia(dias);
    const [dup] = await db.query(
      'INSERT IGNORE INTO sent_reminders (ref_key, channel) VALUES (?, ?)',
      [`prazo_sem_caso_${r.id}_${r.hoje}`, 'sino']) as any;
    if (!dup.affectedRows) continue;
    const quando = dias === 0 ? 'HOJE' : dias === 1 ? 'amanhã' : `em ${dias} dias`;
    for (const a of admins) {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
         VALUES (?, ?, ?, 'prazo_sem_caso', 'sistema', NOW(), 'pendente')`,
        [a.id, `${TITULO[nivel]}: ${r.deadline_type || 'Prazo'} vence ${quando}`,
         `Processo ${r.process_number || ''} — o prazo "${r.deadline_type || 'Prazo'}" (${r.due.split('-').reverse().join('/')}) NÃO está nos avisos automáticos porque o processo ainda não foi vinculado a um caso. Vincule o processo a um caso agora.`]
      ).catch(() => {});
    }
    avisos++;
  }
  return { prazos: rows.length, avisos };
}
