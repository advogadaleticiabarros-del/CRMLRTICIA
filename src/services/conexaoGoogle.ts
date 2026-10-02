import { db } from '../config/database';

/**
 * A conexão Google de uma rotina (Gmail parceria/tribunal) caiu? Olha a
 * execução mais recente: erro com invalid_grant/unauthorized = autorização
 * revogada pelo Google — precisa reconectar (caso real: 29/09–02/10/2026).
 */
export async function conexaoExpirada(job: string): Promise<boolean> {
  const [[r]] = await db.query(
    'SELECT status, message FROM job_runs WHERE job = ? ORDER BY ran_at DESC LIMIT 1', [job]
  ).catch(() => [[null]]) as any;
  return !!r && r.status === 'erro' && /invalid_grant|unauthorized|invalid_token|revoked/i.test(String(r.message || ''));
}
