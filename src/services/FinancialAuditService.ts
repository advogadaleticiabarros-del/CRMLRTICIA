import { db } from '../config/database';

/**
 * Trilha de auditoria financeira — grava em `financial_audit_logs`.
 *
 * Toda alteração relevante em receitas, parcelas, acordos e repasses chama
 * `logFinancialAudit`. A gravação NUNCA deve derrubar a operação principal:
 * por isso o helper engole erros (apenas loga no console).
 */

export interface AuditEntry {
  entityType: string;          // Receita | Parcela | Agreement | Repasse | Inadimplencia
  entityId: number;
  action: string;              // created | updated | cancelled | paid | signed | closed | ...
  userId?: number | null;
  userName?: string | null;
  clientId?: number | null;
  caseId?: number | null;
  receitaId?: number | null;
  parcelaId?: number | null;
  agreementId?: number | null;
  repasseId?: number | null;
  oldValue?: number | null;
  newValue?: number | null;
  oldStatus?: string | null;
  newStatus?: string | null;
  reason?: string | null;
  ipAddress?: string | null;
}

export async function logFinancialAudit(e: AuditEntry): Promise<void> {
  try {
    await db.query(
      `INSERT INTO financial_audit_logs
         (entity_type, entity_id, action, user_id, user_name, client_id, case_id,
          receita_id, parcela_id, agreement_id, repasse_id,
          old_value, new_value, old_status, new_status, reason, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.entityType, e.entityId, e.action,
        e.userId ?? null, e.userName ?? null,
        e.clientId ?? null, e.caseId ?? null,
        e.receitaId ?? null, e.parcelaId ?? null, e.agreementId ?? null, e.repasseId ?? null,
        e.oldValue ?? null, e.newValue ?? null,
        e.oldStatus ?? null, e.newStatus ?? null,
        e.reason ?? null, e.ipAddress ?? null,
      ]
    );
  } catch (err) {
    console.error('Falha ao gravar auditoria financeira:', (err as Error).message);
  }
}
