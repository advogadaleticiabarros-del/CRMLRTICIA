import { db } from '../config/database';
import { logTimeline } from './TimelineService';
import { logActivity } from './JourneyService';

/**
 * Disparado quando um contrato é assinado (manualmente ou por assinatura eletrônica).
 * Sem retrabalho: cria o PROCESSO na esteira de produção e gera os HONORÁRIOS no
 * financeiro a partir do valor do contrato. Idempotente (não duplica).
 */
export async function onContractSigned(contractId: number, actorId: number, actorName?: string | null): Promise<{ caseId: number | null; receitaId: number | null }> {
  const [[ct]] = await db.query('SELECT * FROM contracts WHERE id = ?', [contractId]) as any;
  if (!ct || !ct.client_id) return { caseId: null, receitaId: null };
  const actor = actorId || ct.user_id; // fallback: dono do contrato (assinatura pública)

  // Marca o contrato como assinado
  await db.query("UPDATE contracts SET status = 'assinado' WHERE id = ?", [contractId]);

  // Já processado? (processo de origem existe) — não duplica
  const [existsCase] = await db.query('SELECT id FROM cases WHERE origin_contract_id = ?', [contractId]) as any;
  if (existsCase.length) return { caseId: existsCase[0].id, receitaId: null };

  // 1) Cria o PROCESSO na esteira de produção (separação de documentos)
  const [caseRes] = await db.query(
    `INSERT INTO cases (user_id, client_id, title, legal_area, phase, status, production_stage, origin_contract_id, description)
     VALUES (?, ?, ?, ?, 'inicial', 'ativo', 'separacao_documentos', ?, ?)`,
    [ct.user_id, ct.client_id, String(ct.title || 'Processo').replace('Contrato', 'Processo'), ct.area, contractId,
     'Caso criado automaticamente a partir do contrato assinado.']
  ) as any;
  const caseId = caseRes.insertId;

  // 2) Gera os HONORÁRIOS no financeiro (receita) a partir do valor do contrato
  let receitaId: number | null = null;
  const valor = Number(ct.value) || 0;
  if (valor > 0) {
    const venc = new Date(); venc.setDate(venc.getDate() + 30);
    const vencStr = venc.toISOString().split('T')[0];
    const [r] = await db.query(
      `INSERT INTO receitas (client_id, case_id, descricao, tipo, valor, status, data_vencimento, total_recebido, saldo_pendente, criado_por)
       VALUES (?, ?, ?, 'honorario', ?, 'aberto', ?, 0, ?, ?)`,
      [ct.client_id, caseId, `Honorários contratuais — ${ct.title || ''}`, valor, vencStr, valor, actor]
    ) as any;
    receitaId = r.insertId;
  }

  const fin = valor > 0 ? ` Honorários de R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} lançados no financeiro.` : '';
  await logTimeline({ clientId: ct.client_id, caseId, contractId, eventType: 'contrato_assinado',
    description: `Contrato assinado. Processo criado (esteira: separação de documentos).${fin}`, userId: actor });
  await logActivity({ clientId: ct.client_id, caseId, eventType: 'contrato_assinado', title: 'Contrato assinado',
    description: `Processo criado e honorários gerados automaticamente.${fin}`, actorId: actor, actorName });

  return { caseId, receitaId };
}
