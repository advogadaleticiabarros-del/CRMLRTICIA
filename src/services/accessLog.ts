import { db } from '../config/database';

/**
 * Log de acesso a dados pessoais (LGPD): registra quem abriu a ficha de qual
 * cliente/caso e quando. Best-effort — nunca bloqueia a requisição.
 */
export function logAccess(opts: {
  userId: number; userName?: string | null;
  clientId?: number | null; caseId?: number | null;
  action: string; ip?: string | null;
}): void {
  db.query(
    `INSERT INTO access_logs (user_id, user_name, client_id, case_id, action, ip)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [opts.userId, opts.userName ?? null, opts.clientId ?? null, opts.caseId ?? null,
     opts.action, opts.ip ?? null]
  ).catch(() => { /* tabela pode não existir antes da migration 059 */ });
}
