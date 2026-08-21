import { db } from '../config/database';
import { sendEmail, layout } from './EmailService';

interface TarefaSnapshot { id: number; titulo: string; status: string; }
interface SnapshotPayload { tarefas: TarefaSnapshot[]; }

/**
 * Compara o snapshot salvo de manhã com o estado atual. Regra (decisão da
 * usuária, spec seção 6): "concluído" é TUDO que mudou de status hoje — não
 * só o que já estava no snapshot da manhã. Pura, sem I/O — fácil de testar.
 */
export function compararSnapshotComEstadoAtual(
  manha: SnapshotPayload | null,
  agora: SnapshotPayload
): { concluidos: string[]; pendentes: string[] } {
  const statusConcluido = new Set(['concluida', 'concluido', 'pago', 'protocolado']);
  const concluidos: string[] = [];
  const pendentes: string[] = [];
  for (const t of agora.tarefas) {
    if (statusConcluido.has(t.status)) concluidos.push(t.titulo);
    else pendentes.push(t.titulo);
  }
  return { concluidos, pendentes };
}

/** Salva o retrato do que saiu no briefing da manhã, para comparar às 18:30. */
export async function salvarSnapshotDoDia(userId: number, payload: SnapshotPayload): Promise<void> {
  await db.query(
    `INSERT INTO briefing_snapshots (user_id, snapshot_date, payload)
     VALUES (?, CURDATE(), ?)
     ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
    [userId, JSON.stringify(payload)]
  );
}

async function buscarSnapshotDeHoje(userId: number): Promise<SnapshotPayload | null> {
  const [[row]] = await db.query(
    'SELECT payload FROM briefing_snapshots WHERE user_id = ? AND snapshot_date = CURDATE()',
    [userId]
  ) as any;
  if (!row) return null;
  try { return JSON.parse(row.payload); } catch { return null; }
}

async function estadoAtualDasTarefas(userId: number): Promise<SnapshotPayload> {
  const [rows] = await db.query(
    `SELECT id, title AS titulo, status FROM tasks
      WHERE user_id = ? AND due_date IS NOT NULL
        AND DATE(CONVERT_TZ(due_date,'+00:00','-03:00')) = DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))`,
    [userId]
  ) as any;
  return { tarefas: rows };
}

/** Envia o fechamento do dia (18:30) por e-mail, para quem recebe o briefing matinal. */
export async function sendEveningClosing(): Promise<{ sent: number; failed: number }> {
  const [users] = await db.query(
    `SELECT id, name, email FROM users WHERE active = 1 AND role IN ('admin','advogado') AND email IS NOT NULL AND email <> ''`
  ) as any;

  let sent = 0, failed = 0;
  for (const u of users) {
    try {
      const manha = await buscarSnapshotDeHoje(u.id);
      const agora = await estadoAtualDasTarefas(u.id);
      const { concluidos, pendentes } = compararSnapshotComEstadoAtual(manha, agora);
      const firstName = (u.name || 'Dra.').split(' ')[0];

      const body = `
        <p style="font-size:19px;font-weight:700;color:#1f3047;margin:0 0 16px">Fechamento do dia, Dra. ${firstName} 🌙</p>
        <h3 style="color:#1f3047;font-size:15px">✅ Concluído hoje</h3>
        <p>${concluidos.length ? concluidos.join('<br>') : 'Nada marcado como concluído hoje.'}</p>
        <h3 style="color:#1f3047;font-size:15px">⏳ Ficou pendente</h3>
        <p>${pendentes.length ? pendentes.join('<br>') : 'Nada pendente — dia limpo!'}</p>`;
      const r = await sendEmail({ to: u.email, subject: '🌙 Fechamento do dia', html: layout('Fechamento do dia', body) });
      if (r.ok) sent++; else failed++;
    } catch {
      failed++;
    }
  }
  return { sent, failed };
}
