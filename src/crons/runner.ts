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
 * Checa se essa rotina já rodou com sucesso dentro da janela — proteção contra
 * a rotina disparar 2x seguidas (ex.: dois processos do servidor de pé ao
 * mesmo tempo por alguns instantes durante um deploy no Railway).
 *
 * BUG QUE RESOLVE: Dra. Letícia reportou o e-mail de resumo matinal e o de
 * fechamento do dia chegando 2x seguidas. `startCronJobs` só é chamado 1x por
 * processo e cada `cron.schedule` só tem 1 linha — não há duplicação dentro
 * de um processo. A causa mais provável é infraestrutura: se por um instante
 * 2 cópias do processo Node estiverem rodando (deploy trocando a instância
 * antiga pela nova, ou réplicas > 1 no painel do Railway), CADA uma dispara
 * seu próprio cron.schedule e manda o e-mail de forma independente. Isso não
 * aparece no código-fonte (não há gerenciador de processos/cluster aqui —
 * `npm start` roda 1 processo Node só) — é uma condição do ambiente de deploy.
 *
 * Esta trava não elimina a causa raiz (isso está fora do código, é config de
 * infra), mas neutraliza o SINTOMA: mesmo que 2 processos dessa rotina
 * disparem quase juntos, só o primeiro que gravar em job_runs efetivamente
 * roda e manda e-mail — o segundo vê o registro 'ok' recente e pula.
 *
 * Ainda existe uma corrida teórica (os dois podem checar job_runs ao mesmo
 * tempo, antes de qualquer um ter gravado) — não é 100% à prova de corrida
 * sem uma constraint de unicidade no banco, mas cobre o caso prático real
 * (processos que sobem alguns segundos/minutos separados um do outro).
 */
async function jaRodouComSucessoNaJanela(job: string, janelaMin: number): Promise<boolean> {
  try {
    const [[r]] = await db.query(
      `SELECT COUNT(*) AS n FROM job_runs
        WHERE job = ? AND status = 'ok' AND ran_at >= NOW() - INTERVAL ? MINUTE`,
      [job, janelaMin]
    ) as any;
    return Number(r?.n) > 0;
  } catch {
    return false; // tabela pode não existir ainda — não bloqueia a rotina
  }
}

/**
 * Roda uma rotina com registro e alerta. Nunca lança.
 * @param job     nome legível (aparece no log, no painel e no aviso)
 * @param fn      a rotina
 * @param opts.critica  prazos/backup/financeiro → alerta com prioridade
 * @param opts.silencioso  não loga o sucesso (para rotinas de 5 em 5 min)
 * @param opts.janelaIdempotenciaMin  se definido, pula a execução caso já
 *   exista um registro 'ok' desta MESMA rotina nos últimos N minutos — usado
 *   nas rotinas de e-mail (matinal/fechamento) para não mandar 2x seguidas se
 *   2 processos do servidor rodarem ao mesmo tempo por um instante. NÃO use
 *   em rotinas que já rodam com frequência menor que a janela (ex.: a cada
 *   5 min) — bloquearia a execução legítima seguinte.
 */
export async function runJob(
  job: string,
  fn: () => Promise<any>,
  opts: { critica?: boolean; silencioso?: boolean; janelaIdempotenciaMin?: number } = {}
): Promise<void> {
  if (opts.janelaIdempotenciaMin && await jaRodouComSucessoNaJanela(job, opts.janelaIdempotenciaMin)) {
    console.warn(`⏭️ [cron] ${job} pulado — já rodou com sucesso nos últimos ${opts.janelaIdempotenciaMin} min (provável 2º processo/instância rodando em paralelo).`);
    return;
  }
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
