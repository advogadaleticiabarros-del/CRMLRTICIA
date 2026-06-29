import { db } from '../config/database';
import { runEstagiarioForDeadline } from './aiAssistant';
import { telegramNotificationService } from './TelegramNotificationService';

/**
 * Motor de automação (playbooks). Regras prontas, cada uma ligável/desligável
 * em automation_rules. A base é genérica (trigger_type + config JSON) para
 * evoluir para regras personalizadas (no-code) depois.
 */
export interface Playbook {
  key: string;
  name: string;
  description: string;
  trigger: string;       // evento que dispara (intimacao_detectada, prazo_confirmado…)
  defaultEnabled: boolean;
}

export const PLAYBOOKS: Playbook[] = [
  {
    key: 'estagiario_intimacao', trigger: 'intimacao_detectada',
    name: 'Estagiário IA: análise + minuta na intimação',
    description: 'Ao detectar uma intimação (DJEN), gera automaticamente a análise (resumo, prazo, próxima ação, risco) e a minuta da peça para revisão.',
    defaultEnabled: true,
  },
  {
    key: 'intimacao_telegram', trigger: 'intimacao_detectada',
    name: 'Avisar no Telegram quando chega intimação',
    description: 'Envia um resumo da intimação detectada por Telegram aos administradores com Telegram configurado.',
    defaultEnabled: false,
  },
  {
    key: 'prazo_confirmado_sem_caso', trigger: 'prazo_confirmado',
    name: 'Tarefa para vincular processo sem caso',
    description: 'Ao confirmar um prazo cujo processo ainda não tem caso vinculado, cria uma tarefa para fazer o vínculo.',
    defaultEnabled: true,
  },
  {
    key: 'prazo_confirmado_agenda', trigger: 'prazo_confirmado',
    name: 'Agendar o prazo na agenda (com Google)',
    description: 'Ao confirmar um prazo, cria automaticamente um evento na agenda na data-limite (sincroniza com o Google Calendar) e avisa os administradores.',
    defaultEnabled: true,
  },
];

const byKey = (key: string) => PLAYBOOKS.find((p) => p.key === key);

/** Regra ligada? Cai no default do registro se a tabela/linha ainda não existir. */
export async function isEnabled(key: string): Promise<boolean> {
  const def = byKey(key)?.defaultEnabled ?? false;
  try {
    const [rows] = await db.query('SELECT enabled FROM automation_rules WHERE rule_key = ? LIMIT 1', [key]) as any;
    if (!rows.length) return def;
    return !!rows[0].enabled;
  } catch {
    return def; // migration ainda não aplicada
  }
}

async function logRun(ruleKey: string, triggerRef: string | null, status: string, message?: string): Promise<void> {
  try {
    await db.query(
      'INSERT INTO automation_runs (rule_key, trigger_ref, status, message) VALUES (?, ?, ?, ?)',
      [ruleKey, triggerRef, status, message?.slice(0, 500) ?? null]
    );
  } catch { /* log é best-effort */ }
}

/** Lista as regras com o estado atual (mesclando registro + banco). Para a tela de Configurações. */
export async function listRules(): Promise<(Playbook & { enabled: boolean })[]> {
  const out: (Playbook & { enabled: boolean })[] = [];
  for (const p of PLAYBOOKS) out.push({ ...p, enabled: await isEnabled(p.key) });
  return out;
}

/** Liga/desliga uma regra (upsert). */
export async function setRuleEnabled(key: string, enabled: boolean): Promise<boolean> {
  const p = byKey(key);
  if (!p) return false;
  await db.query(
    `INSERT INTO automation_rules (rule_key, name, description, trigger_type, enabled)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
    [p.key, p.name, p.description, p.trigger, enabled ? 1 : 0]
  );
  return true;
}

// ── Gatilho: intimação detectada ────────────────────────────────────────────
export interface IntimacaoCtx {
  detectedDeadlineId: number;
  clientId: number | null;
  movementText: string;
  suggestedType: string;
  suggestedDays: number;
  processNumber?: string;
  processId?: number | null;
}

export async function runIntimacaoPlaybooks(ctx: IntimacaoCtx): Promise<void> {
  const ref = `detected_deadline:${ctx.detectedDeadlineId}`;

  // 1) Estagiário IA — gera análise + minuta (e arquiva a minuta no GED do caso)
  if (await isEnabled('estagiario_intimacao')) {
    try {
      await runEstagiarioForDeadline({
        detectedDeadlineId: ctx.detectedDeadlineId, clientId: ctx.clientId, processId: ctx.processId ?? null,
        movementText: ctx.movementText, suggestedType: ctx.suggestedType, suggestedDays: ctx.suggestedDays,
      });
      await logRun('estagiario_intimacao', ref, 'ok');
    } catch (e: any) {
      await logRun('estagiario_intimacao', ref, 'erro', e?.message);
    }
  }

  // 2) Aviso por Telegram (usa a análise do estagiário, se houver)
  if (await isEnabled('intimacao_telegram')) {
    try {
      const [[dd]] = await db.query('SELECT ai_summary FROM detected_deadlines WHERE id = ?', [ctx.detectedDeadlineId]) as any;
      const corpo = (dd?.ai_summary || ctx.movementText || '').slice(0, 600);
      const titulo = `Intimação detectada — ${ctx.suggestedType}${ctx.processNumber ? ' (proc. ' + ctx.processNumber + ')' : ''}`;
      const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
      let enviados = 0;
      for (const a of admins) {
        const ok = await telegramNotificationService.send(a.id, { title: titulo, body: corpo, urgency: 'high' });
        if (ok) enviados++;
      }
      await logRun('intimacao_telegram', ref, 'ok', `${enviados} envio(s)`);
    } catch (e: any) {
      await logRun('intimacao_telegram', ref, 'erro', e?.message);
    }
  }
}

// ── Gatilho: prazo confirmado ────────────────────────────────────────────────
export interface PrazoConfirmadoCtx {
  processId: number | null;
  caseId: number | null;
  deadlineType: string;
  userId: number;
  clientId: number | null;
  dueDate?: string | null;       // data-limite YYYY-MM-DD
  deadlineId?: number | null;
}

export async function runPrazoConfirmadoPlaybooks(ctx: PrazoConfirmadoCtx): Promise<void> {
  // Tarefa para vincular processo sem caso
  if (ctx.processId && !ctx.caseId && await isEnabled('prazo_confirmado_sem_caso')) {
    const ref = `process:${ctx.processId}`;
    try {
      const [[lp]] = await db.query('SELECT process_number FROM legal_processes WHERE id = ?', [ctx.processId]) as any;
      await db.query(
        `INSERT INTO tasks (user_id, client_id, title, description, due_date, priority, status)
         VALUES (?, ?, ?, ?, NOW(), 'media', 'pendente')`,
        [ctx.userId, ctx.clientId ?? null,
         `Vincular processo ${lp?.process_number || ''} a um caso`,
         `Prazo "${ctx.deadlineType}" confirmado, mas o processo ainda não está vinculado a um caso. Vincule para ativar os alertas automáticos de prazo (30/15/7/3/1 dia).`]
      );
      await logRun('prazo_confirmado_sem_caso', ref, 'ok');
    } catch (e: any) {
      await logRun('prazo_confirmado_sem_caso', ref, 'erro', e?.message);
    }
  }

  // Agenda o prazo na agenda (entra no Google sync) na data-limite
  if (ctx.dueDate && await isEnabled('prazo_confirmado_agenda')) {
    const ref = `deadline:${ctx.deadlineId ?? ''}`;
    try {
      const inicio = `${ctx.dueDate} 09:00:00`;
      const fim = `${ctx.dueDate} 10:00:00`;
      await db.query(
        `INSERT INTO calendar_events
           (user_id, client_id, case_id, deadline_id, title, description, event_type, start_datetime, end_datetime, source, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, 'prazo', ?, ?, 'crm', 'pendente')`,
        [ctx.userId, ctx.clientId ?? null, ctx.caseId ?? null, ctx.deadlineId ?? null,
         `Prazo: ${ctx.deadlineType}`, 'Prazo confirmado a partir do monitoramento.', inicio, fim]
      );
      const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
      for (const a of admins) {
        await db.query(
          `INSERT INTO notifications (user_id, client_id, title, message, notification_type, channel, scheduled_at, status)
           VALUES (?, ?, ?, ?, 'prazo_agendado', 'sistema', NOW(), 'pendente')`,
          [a.id, ctx.clientId ?? null, 'Prazo agendado na agenda', `Prazo "${ctx.deadlineType}" agendado para ${ctx.dueDate}.`]
        );
      }
      await logRun('prazo_confirmado_agenda', ref, 'ok');
    } catch (e: any) {
      await logRun('prazo_confirmado_agenda', ref, 'erro', e?.message);
    }
  }
}
