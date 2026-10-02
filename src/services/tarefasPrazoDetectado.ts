/**
 * Fecha as tarefas "Analisar …" quando o prazo detectado a que se referem é
 * confirmado ou descartado, e liga as tarefas antigas (sem vínculo) pelo nº
 * do processo. Regras em `tarefaAnalisar.ts`.
 */
import { db } from '../config/database';
import { lerTituloAnalisar, deveFechar } from './tarefaAnalisar';

export async function fecharTarefasDoPrazo(detectedDeadlineIds: (number | string)[]): Promise<number> {
  const ids = detectedDeadlineIds.map(Number).filter(Boolean);
  if (!ids.length) return 0;
  const [r] = await db.query(
    "UPDATE tasks SET status = 'concluida' WHERE detected_deadline_id IN (?) AND status IN ('pendente','em_andamento')", [ids]) as any;
  return r.affectedRows || 0;
}

/** Liga tarefas "Analisar" antigas ao prazo detectado e fecha as já resolvidas. Idempotente. */
export async function sanearTarefasAnalisar(): Promise<{ ligadas: number; fechadas: number }> {
  const [tarefas] = await db.query(
    "SELECT id, title, created_at FROM tasks WHERE title LIKE 'Analisar %' AND detected_deadline_id IS NULL AND status IN ('pendente','em_andamento')") as any;
  let ligadas = 0;
  for (const t of tarefas) {
    const lido = lerTituloAnalisar(t.title);
    if (!lido?.digitos) continue;
    // O prazo detectado criado junto com a tarefa: mesmo processo e tipo, criação mais próxima.
    const [[dd]] = await db.query(
      `SELECT d.id FROM detected_deadlines d JOIN legal_processes lp ON lp.id = d.process_id
        WHERE REGEXP_REPLACE(lp.process_number, '[^0-9]', '') = ? AND d.suggested_type = ?
        ORDER BY ABS(TIMESTAMPDIFF(SECOND, d.created_at, ?)) LIMIT 1`, [lido.digitos, lido.tipo, t.created_at]) as any;
    if (!dd) continue;
    await db.query('UPDATE tasks SET detected_deadline_id = ? WHERE id = ?', [dd.id, t.id]);
    ligadas++;
  }
  const [abertas] = await db.query(
    `SELECT t.id, d.status FROM tasks t JOIN detected_deadlines d ON d.id = t.detected_deadline_id
      WHERE t.status IN ('pendente','em_andamento')`) as any;
  const fechar = abertas.filter((a: any) => deveFechar(a.status)).map((a: any) => a.id);
  if (fechar.length) await db.query("UPDATE tasks SET status = 'concluida' WHERE id IN (?)", [fechar]);
  return { ligadas, fechadas: fechar.length };
}
