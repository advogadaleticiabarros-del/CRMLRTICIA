import { db } from '../config/database';

/**
 * Executor das rotinas automáticas.
 *
 * PROBLEMA QUE RESOLVE: antes, todas as ~20 rotinas usavam `catch {}` — o erro
 * era engolido em silêncio. Uma falha no cron de PRAZOS ou no BACKUP podia durar
 * dias sem ninguém notar (foi o que aconteceu com o sync do Gmail).
 *
 * O comportamento de "não derrubar o servidor" está CERTO e foi mantido. O que
 * muda é que a falha agora:
 *   1. aparece no log (com nome da rotina, tempo e mensagem);
 *   2. fica registrada em `job_runs` (painel de saúde);
 *   3. avisa os admins no sino do CRM — com anti-spam, para não repetir a cada 5 min.
 */

const JANELA_AVISO_HORAS = 6; // não repete o mesmo aviso antes disso

async function registrar(job: string, status: 'ok' | 'erro', message: string | null, ms: number): Promise<void> {
  try {
    await db.query(
      'INSERT INTO job_runs (job, status, message, duration_ms) VALUES (?, ?, ?, ?)',
      [job, status, message ? String(message).slice(0, 2000) : null, ms]
    );
  } catch { /* a tabela pode não existir antes da migration 069 — não trava a rotina */ }
}

/** Avisa os admins no sino, no máximo 1x por janela, por rotina. */
async function avisarAdmins(job: string, erro: string, critica: boolean): Promise<void> {
  try {
    const [[j]] = await db.query(
      `SELECT COUNT(*) AS n FROM notifications
        WHERE notification_type = 'rotina_falhou' AND title LIKE ?
          AND created_at >= NOW() - INTERVAL ? HOUR`,
      [`%${job}%`, JANELA_AVISO_HORAS]
    ) as any;
    if (Number(j?.n) > 0) return; // já avisado nesta janela

    const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
    for (const a of admins) {
      await db.query(
        `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
         VALUES (?, ?, ?, 'rotina_falhou', 'sistema', NOW(), 'pendente')`,
        [a.id,
         `${critica ? '🚨' : '⚠️'} Rotina automática falhou: ${job}`,
         `A rotina "${job}" falhou com o erro: ${String(erro).slice(0, 400)}\n\n` +
         (critica
           ? 'Esta rotina é CRÍTICA (prazos, backup ou financeiro). Verifique com prioridade.'
           : 'Confira em Configurações → Saúde das rotinas.')]
      );
    }
  } catch { /* avisar é best-effort — nunca pode derrubar a rotina */ }
}

/**
 * Roda uma rotina com registro e alerta. Nunca lança.
 * @param job     nome legível (aparece no log, no painel e no aviso)
 * @param fn      a rotina
 * @param opts.critica  prazos/backup/financeiro → alerta com prioridade
 * @param opts.silencioso  não loga o sucesso (para rotinas de 5 em 5 min)
 */
export async function runJob(
  job: string,
  fn: () => Promise<any>,
  opts: { critica?: boolean; silencioso?: boolean } = {}
): Promise<void> {
  const t0 = Date.now();
  try {
    const r = await fn();
    const ms = Date.now() - t0;
    const resumo = r && typeof r === 'object' ? JSON.stringify(r).slice(0, 300) : null;
    if (!opts.silencioso) console.log(`✅ [cron] ${job} (${ms}ms)${resumo ? ' · ' + resumo : ''}`);
    await registrar(job, 'ok', resumo, ms);
  } catch (e: any) {
    const ms = Date.now() - t0;
    const msg = e?.message || String(e);
    // ANTES: catch {} — o erro sumia. AGORA: grita.
    console.error(`❌ [cron] ${job} FALHOU (${ms}ms):`, msg);
    if (e?.stack) console.error(e.stack);
    await registrar(job, 'erro', msg, ms);
    await avisarAdmins(job, msg, !!opts.critica);
  }
}
