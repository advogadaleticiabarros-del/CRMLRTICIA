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

  // 2) Gera os HONORÁRIOS no financeiro conforme o PARCELAMENTO da proposta
  //    (entrada + parcelas nas datas certas). Sem proposta, usa o valor do contrato.
  let receitaId: number | null = null;
  let totalLancado = 0;
  let parcelasGeradas = 0;

  const addMonths = (base: Date, n: number) => { const d = new Date(base); d.setMonth(d.getMonth() + n); return d; };
  const dstr = (d: Date) => d.toISOString().split('T')[0];

  // Proposta vinculada (mesmo lead/cliente) com parcelamento definido
  const [props] = await db.query(
    `SELECT honorarios FROM propostas
      WHERE (lead_id <=> ? OR client_id <=> ?) AND honorarios IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [ct.lead_id ?? null, ct.client_id ?? null]
  ) as any;
  let parc: any = null;
  if (props.length) {
    const h = typeof props[0].honorarios === 'string' ? JSON.parse(props[0].honorarios) : props[0].honorarios;
    if (h?.parcelamento && Number(h.parcelamento.total) > 0) parc = h.parcelamento;
  }

  if (parc) {
    const total = Number(parc.total) || 0;
    const entrada = Number(parc.entrada) || 0;
    const nParc = Math.max(0, parseInt(parc.parcelas) || 0);
    const vParc = Number(parc.valor_parcela) || 0;
    const ultima = Number(parc.ultima_parcela) || vParc;
    const entradaData = parc.entrada_data ? new Date(parc.entrada_data + 'T00:00:00') : new Date();
    const primeiroVenc = parc.primeiro_vencimento ? new Date(parc.primeiro_vencimento + 'T00:00:00') : addMonths(new Date(), 1);

    const linhas: { valor: number; venc: string }[] = [];
    if (entrada > 0) linhas.push({ valor: entrada, venc: dstr(entradaData) });
    for (let i = 0; i < nParc; i++) linhas.push({ valor: i === nParc - 1 ? ultima : vParc, venc: dstr(addMonths(primeiroVenc, i)) });
    if (!linhas.length) linhas.push({ valor: total, venc: dstr(primeiroVenc) });

    const [r] = await db.query(
      `INSERT INTO receitas (client_id, case_id, descricao, tipo, valor, status, data_vencimento, total_recebido, saldo_pendente, criado_por)
       VALUES (?, ?, ?, 'honorario', ?, 'aberto', ?, 0, ?, ?)`,
      [ct.client_id, caseId, `Honorários contratuais — ${ct.title || ''}`, total, linhas[0].venc, total, actor]
    ) as any;
    receitaId = r.insertId;
    for (let i = 0; i < linhas.length; i++) {
      await db.query(
        `INSERT INTO parcelas (receita_id, numero, total_parcelas, valor, valor_final, status, data_vencimento)
         VALUES (?, ?, ?, ?, ?, 'aberto', ?)`,
        [receitaId, i + 1, linhas.length, linhas[i].valor, linhas[i].valor, linhas[i].venc]
      );
    }
    totalLancado = total;
    parcelasGeradas = linhas.length;
  } else {
    const valor = Number(ct.value) || 0;
    if (valor > 0) {
      const venc = new Date(); venc.setDate(venc.getDate() + 30);
      const [r] = await db.query(
        `INSERT INTO receitas (client_id, case_id, descricao, tipo, valor, status, data_vencimento, total_recebido, saldo_pendente, criado_por)
         VALUES (?, ?, ?, 'honorario', ?, 'aberto', ?, 0, ?, ?)`,
        [ct.client_id, caseId, `Honorários contratuais — ${ct.title || ''}`, valor, dstr(venc), valor, actor]
      ) as any;
      receitaId = r.insertId;
      totalLancado = valor;
    }
  }

  const fin = totalLancado > 0
    ? ` Honorários de R$ ${totalLancado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}${parcelasGeradas > 1 ? ` em ${parcelasGeradas}x` : ''} lançados no financeiro.`
    : '';
  await logTimeline({ clientId: ct.client_id, caseId, contractId, eventType: 'contrato_assinado',
    description: `Contrato assinado. Processo criado (esteira: separação de documentos).${fin}`, userId: actor });
  await logActivity({ clientId: ct.client_id, caseId, eventType: 'contrato_assinado', title: 'Contrato assinado',
    description: `Processo criado e honorários gerados automaticamente.${fin}`, actorId: actor, actorName });

  return { caseId, receitaId };
}
