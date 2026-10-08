import { db } from '../config/database';
import { logFinancialAudit } from './FinancialAuditService';
import { Recebimento } from './recebimentoRegras';

/**
 * "Recebi um pagamento": grava receita + parcela já pagas (uma transação) e a
 * auditoria financeira. Regra única da tela (POST /api/receitas/recebimento) e do
 * assistente do WhatsApp ("recebi 500 da Fulana"). Movida de routes/receitas.ts
 * em 08/10/2026 sem mudar a lógica. Devolve o id da receita.
 */
export async function registrarRecebimentoCliente(dados: Recebimento, ator: { id: number | null; name: string; ip?: string | null }): Promise<number> {
  const conn = await db.getConnection();
  let receitaId = 0;
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO receitas (client_id, case_id, descricao, tipo, valor, status, data_vencimento, total_recebido, saldo_pendente, criado_por)
       VALUES (?, ?, ?, 'honorario', ?, 'recebido', ?, ?, 0, ?)`,
      [dados.client_id, dados.case_id, `${dados.descricao} (${dados.forma})`, dados.valor, dados.data, dados.valor, ator.id]) as any;
    receitaId = r.insertId;
    await conn.query(
      `INSERT INTO parcelas (receita_id, numero, total_parcelas, valor, valor_final, status, data_vencimento, data_pagamento)
       VALUES (?, 1, 1, ?, ?, 'pago', ?, ?)`,
      [receitaId, dados.valor, dados.valor, dados.data, `${dados.data} 12:00:00`]);
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }

  await logFinancialAudit({
    entityType: 'Receita', entityId: receitaId, action: 'created',
    userId: ator.id, userName: ator.name, clientId: dados.client_id, caseId: dados.case_id,
    receitaId, newValue: dados.valor, newStatus: 'recebido',
    reason: `Recebimento registrado (${dados.forma})`, ipAddress: ator.ip ?? null,
  }).catch(() => {});
  return receitaId;
}
