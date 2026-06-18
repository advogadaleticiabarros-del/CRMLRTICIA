import { db } from '../config/database';

export type DeadlineStatusLabel = 'vencido' | 'urgente' | 'atencao' | 'normal';

interface CounterResult {
  daysRemaining: number;
  hoursRemaining: number;
  statusLabel: DeadlineStatusLabel;
}

export class DeadlineCounterService {
  calculate(dueDate: Date): CounterResult {
    const now = new Date();
    const diffMs = dueDate.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    let statusLabel: DeadlineStatusLabel;
    if (diffMs < 0) {
      statusLabel = 'vencido';
    } else if (diffHours <= 24) {
      statusLabel = 'urgente';
    } else if (diffDays <= 3) {
      statusLabel = 'atencao';
    } else {
      statusLabel = 'normal';
    }

    return {
      daysRemaining: Math.max(0, diffDays),
      hoursRemaining: Math.max(0, diffHours),
      statusLabel,
    };
  }

  /** Recalcula e grava o contador de um único prazo ou tarefa. */
  async upsert(opts: { taskId?: number | null; deadlineId?: number | null; dueDate: Date }): Promise<void> {
    const { daysRemaining, hoursRemaining, statusLabel } = this.calculate(opts.dueDate);
    await db.query(
      `INSERT INTO task_deadline_counters
         (task_id, deadline_id, days_remaining, hours_remaining, status_label, last_calculated_at)
       VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         days_remaining = VALUES(days_remaining),
         hours_remaining = VALUES(hours_remaining),
         status_label = VALUES(status_label),
         last_calculated_at = NOW()`,
      [opts.taskId ?? null, opts.deadlineId ?? null, daysRemaining, hoursRemaining, statusLabel]
    );
  }

  async updateAllCounters(): Promise<{ updated: number }> {
    // Upsert counters for tasks
    const [tasks] = await db.query(
      `SELECT id AS task_id, NULL AS deadline_id, due_date AS due
       FROM tasks
       WHERE due_date IS NOT NULL AND status NOT IN ('concluida', 'cancelada')`
    ) as any;

    // Upsert counters for deadlines
    const [deadlines] = await db.query(
      `SELECT NULL AS task_id, id AS deadline_id, deadline_date AS due
       FROM deadlines
       WHERE status NOT IN ('cumprido', 'cancelado')`
    ) as any;

    const all = [...tasks, ...deadlines];
    let updated = 0;

    for (const row of all) {
      const { daysRemaining, hoursRemaining, statusLabel } = this.calculate(new Date(row.due));
      await db.query(
        `INSERT INTO task_deadline_counters
           (task_id, deadline_id, days_remaining, hours_remaining, status_label, last_calculated_at)
         VALUES (?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           days_remaining = VALUES(days_remaining),
           hours_remaining = VALUES(hours_remaining),
           status_label = VALUES(status_label),
           last_calculated_at = NOW()`,
        [row.task_id, row.deadline_id, daysRemaining, hoursRemaining, statusLabel]
      );
      updated++;
    }

    return { updated };
  }

  async getUrgentItems(userId: number) {
    const [rows] = await db.query(
      `SELECT
         tdc.*,
         t.title AS task_title,
         t.due_date AS task_due,
         d.description AS deadline_desc,
         d.deadline_date AS deadline_due
       FROM task_deadline_counters tdc
       LEFT JOIN tasks t     ON t.id = tdc.task_id     AND t.user_id = ?
       LEFT JOIN deadlines d ON d.id = tdc.deadline_id
       WHERE tdc.status_label IN ('vencido', 'urgente', 'atencao')
         AND (t.user_id = ? OR d.id IS NOT NULL)
       ORDER BY tdc.hours_remaining ASC
       LIMIT 50`,
      [userId, userId]
    ) as any;
    return rows;
  }

  async getDashboardAgendaSummary() {
    const [rows] = await db.query(
      `SELECT
         SUM(status_label = 'vencido')  AS vencidos,
         SUM(status_label = 'urgente')  AS urgentes,
         SUM(status_label = 'atencao')  AS atencao,
         SUM(status_label = 'normal')   AS normais
       FROM task_deadline_counters`
    ) as any;
    return rows[0];
  }
}

export const deadlineCounterService = new DeadlineCounterService();
