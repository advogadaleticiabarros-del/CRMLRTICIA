import crypto from 'crypto';
import { db } from '../config/database';
import { getActiveProvider, getProvider } from './processProviders';
import { notificationService } from './NotificationService';
import { telegramNotificationService } from './TelegramNotificationService';
import { logTimeline } from './TimelineService';

function hashMovement(processNumber: string, date: string | null, description: string): string {
  return crypto.createHash('sha256').update(`${processNumber}|${date || ''}|${description}`).digest('hex');
}

/** Converte data (ISO/string) para Date aceito pelo MySQL, ou null. */
function toDate(val: string | null): Date | null {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

interface SyncResult {
  processId: number;
  status: 'sem_novidade' | 'nova_movimentacao' | 'nao_encontrado' | 'erro';
  newMovements: number;
  message?: string;
}

/** Sincroniza UM processo: consulta o provider, salva movimentações novas, notifica. */
export async function syncProcess(processId: number): Promise<SyncResult> {
  const [rows] = await db.query('SELECT * FROM legal_processes WHERE id = ?', [processId]) as any;
  if (!rows.length) return { processId, status: 'erro', newMovements: 0, message: 'Processo não encontrado' };
  const proc = rows[0];

  // processos manuais não consultam fonte externa
  const provider = proc.source === 'manual' ? getProvider('manual') : getActiveProvider();

  let result;
  try {
    result = await provider.getMovements(proc.process_number, proc.court_alias);
  } catch (err: any) {
    await logMonitor(processId, proc.lawyer_id, 'erro', provider.name, err.message);
    return { processId, status: 'erro', newMovements: 0, message: err.message };
  }

  if (!result.found) {
    const status = result.error === 'Processo não encontrado' ? 'nao_encontrado' : 'erro';
    await logMonitor(processId, proc.lawyer_id, status, provider.name, result.error);
    await db.query('UPDATE legal_processes SET last_sync_at = NOW() WHERE id = ?', [processId]);
    return { processId, status, newMovements: 0, message: result.error };
  }

  // insere movimentações novas (dedupe por hash)
  let novas = 0;
  let latest: string | null = proc.last_movement_at;
  for (const m of result.movements) {
    const hash = hashMovement(proc.process_number, m.movement_date, m.description);
    try {
      const [ins] = await db.query(
        `INSERT INTO process_movements (process_id, movement_date, title, description, source, unique_hash)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [processId, toDate(m.movement_date), m.title?.slice(0, 500), m.description, provider.name, hash]
      ) as any;
      if (ins.affectedRows) {
        novas++;
        if (m.movement_date && (!latest || m.movement_date > latest)) latest = m.movement_date;
      }
    } catch (e: any) {
      // duplicada (unique_hash) — ignora
      if (e.code !== 'ER_DUP_ENTRY') throw e;
    }
  }

  await db.query(
    'UPDATE legal_processes SET last_sync_at = NOW(), last_movement_at = ? WHERE id = ?',
    [toDate(latest), processId]
  );

  if (novas > 0) {
    await logMonitor(processId, proc.lawyer_id, 'nova_movimentacao', provider.name, `${novas} nova(s)`);
    await notifyNewMovements(proc, novas);
  } else {
    await logMonitor(processId, proc.lawyer_id, 'sem_novidade', provider.name, 'Sem novidades');
  }

  return { processId, status: novas > 0 ? 'nova_movimentacao' : 'sem_novidade', newMovements: novas };
}

async function notifyNewMovements(proc: any, novas: number) {
  // notifica os admins no sistema
  const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
  const msg = `${novas} nova(s) movimentação(ões) no processo ${proc.process_number}.`;
  for (const a of admins) {
    await notificationService.create({
      userId: a.id, clientId: proc.client_id, title: 'Nova movimentação processual',
      message: msg, notificationType: 'nova_movimentacao', channel: 'sistema', scheduledAt: new Date(),
    });
    await telegramNotificationService.sendMovimentacaoProcessual(a.id, {
      caseRef: proc.process_number, movement: `${novas} nova(s) movimentação(ões).`,
    });
  }
  // histórico do cliente
  if (proc.client_id) {
    await logTimeline({ clientId: proc.client_id, eventType: 'movimentacao_processual',
      description: msg, userId: null });
  }
}

async function logMonitor(processId: number, lawyerId: number | null, status: string, source: string, message?: string) {
  await db.query(
    'INSERT INTO monitoring_logs (process_id, lawyer_id, status, source, message) VALUES (?, ?, ?, ?, ?)',
    [processId, lawyerId ?? null, status, source, message?.slice(0, 500) ?? null]
  );
}

/** Roda o monitoramento de todos os processos ativos com monitoring_enabled. */
export async function runMonitoringJob(): Promise<{ processed: number; withNews: number }> {
  const [procs] = await db.query(
    `SELECT lp.id FROM legal_processes lp
     JOIN lawyers l ON l.id = lp.lawyer_id
     WHERE lp.monitoring_enabled = 1 AND lp.status = 'ativo'
       AND l.monitoring_enabled = 1 AND l.active = 1`
  ) as any;

  let withNews = 0;
  for (const p of procs) {
    const r = await syncProcess(p.id);
    if (r.status === 'nova_movimentacao') withNews++;
  }
  await db.query('UPDATE lawyers SET last_sync_at = NOW() WHERE monitoring_enabled = 1');
  return { processed: procs.length, withNews };
}
