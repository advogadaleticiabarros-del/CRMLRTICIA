import { db } from '../config/database';

/**
 * Monta a lista ÚNICA do A Receber (lançamentos, parcelas de proposta, parcelas de
 * contrato, dativo, correspondente e êxitos), já com vencido e com a parte da
 * parceira separada. Usada pela tela (GET /api/financial/a-receber), pela
 * conciliação OFX e pelo assistente do WhatsApp ("quanto tenho a receber?").
 * Movida de routes/financial.ts em 08/10/2026 sem mudar a lógica.
 */
export async function montarAReceber(): Promise<any[]> {
  const rows: any[] = [];
  const N = (x: any) => Number(x) || 0;
  const hoje = new Date().toISOString().split('T')[0];
  // Cada linha diz de qual PROCESSO é e quanto é da PARCEIRA (07/10/2026:
  // "provisão correta do que é meu e do que não será meu").
  const parceria = (r: any) => (r.pt_nome ? { nome: r.pt_nome, split: N(r.pt_split), sucumbSplit: N(r.pt_sucumb), entrySplit: !!Number(r.pt_entry) } : null);

  const [fr] = await db.query(`
    SELECT fr.id, fr.description, fr.valor, fr.due_date, fr.status, fr.paid_at, cl.name AS client_name,
           COALESCE(c.case_number, ag.process_number) AS processo, pt.name AS pt_nome, pt.partner_split_percent AS pt_split, pt.sucumbencia_split_percent AS pt_sucumb, pt.entry_split AS pt_entry
      FROM financial_records fr LEFT JOIN clients cl ON cl.id = fr.client_id
      LEFT JOIN agreements ag ON ag.id = fr.agreement_id
      LEFT JOIN cases c ON c.id = COALESCE(fr.case_id, ag.case_id)
      LEFT JOIN partners pt ON pt.id = c.partner_id
     WHERE fr.tipo='receita' AND fr.status IN ('pendente','vencido','pago')
     ORDER BY fr.due_date DESC LIMIT 300`) as any;
  for (const r of fr) rows.push({
    fonte: 'lancamento', id: r.id, descricao: r.description, cliente: r.client_name, processo: r.processo || null,
    valor: N(r.valor), vencimento: r.due_date, recebido: r.status === 'pago', pago_em: r.paid_at, _parceria: parceria(r),
  });

  const [inst] = await db.query(`
    SELECT i.id, i.numero, i.valor, i.due_date, i.status, i.paid_at, cl.name AS client_name, p.title AS proposta_title,
           c.case_number AS processo, pt.name AS pt_nome, pt.partner_split_percent AS pt_split, pt.sucumbencia_split_percent AS pt_sucumb, pt.entry_split AS pt_entry
      FROM installments i
      LEFT JOIN clients cl ON cl.id = i.client_id
      LEFT JOIN propostas p ON p.id = i.proposta_id
      LEFT JOIN cases c ON c.id = i.case_id
      LEFT JOIN partners pt ON pt.id = c.partner_id
     WHERE i.status IN ('pendente','em_processamento','vencido','pago')
     ORDER BY i.due_date DESC LIMIT 300`) as any;
  for (const r of inst) rows.push({
    fonte: 'parcela', id: r.id, descricao: `${r.numero}ª parcela${r.proposta_title ? ' — ' + r.proposta_title : ''}`,
    cliente: r.client_name, processo: r.processo || null, valor: N(r.valor), vencimento: r.due_date, recebido: r.status === 'pago', pago_em: r.paid_at,
    _parceria: parceria(r),
  });

  const [parc] = await db.query(`
    SELECT pa.id, pa.numero, pa.total_parcelas, pa.valor_final, pa.data_vencimento, pa.status, pa.data_pagamento,
           re.descricao AS receita_desc, cl.name AS client_name, c.case_number AS processo, pt.name AS pt_nome, pt.partner_split_percent AS pt_split, pt.sucumbencia_split_percent AS pt_sucumb, pt.entry_split AS pt_entry
      FROM parcelas pa
      LEFT JOIN receitas re ON re.id = pa.receita_id
      LEFT JOIN clients cl ON cl.id = re.client_id
      LEFT JOIN cases c ON c.id = re.case_id
      LEFT JOIN partners pt ON pt.id = c.partner_id
     WHERE pa.status IN ('aberto','atrasado','parcial','pago')
     ORDER BY pa.data_vencimento DESC LIMIT 300`).catch(() => [[]]) as any;
  for (const r of parc) rows.push({
    fonte: 'contrato', id: r.id, descricao: `${r.numero}/${r.total_parcelas}${r.receita_desc ? ' — ' + r.receita_desc : ''}`,
    cliente: r.client_name, processo: r.processo || null, valor: N(r.valor_final), vencimento: r.data_vencimento, recebido: r.status === 'pago', pago_em: r.data_pagamento,
    _parceria: parceria(r),
  });

  const [dat] = await db.query(`
    SELECT dp.id, dp.reference, dp.value, dp.expected_date, dp.received_date, dp.status, dc.process_number
      FROM dative_payments dp LEFT JOIN dative_cases dc ON dc.id = dp.dative_case_id
     ORDER BY COALESCE(dp.expected_date, dp.received_date) DESC LIMIT 300`) as any;
  for (const r of dat) rows.push({
    fonte: 'dativo', id: r.id, descricao: r.reference || `Dativo${r.process_number ? ' — proc. ' + r.process_number : ''}`,
    cliente: 'Estado (dativo)', processo: r.process_number || null, valor: N(r.value), vencimento: r.expected_date, recebido: r.status === 'recebido', pago_em: r.received_date,
  });

  // Nomeações dativas sem recebimento lançado — o estimado é o "a receber".
  const [datCasos] = await db.query(`
    SELECT dc.id, dc.assisted_name, dc.comarca, dc.process_number, dc.estimated_value
      FROM dative_cases dc
     WHERE dc.status NOT IN ('paga','recusada') AND dc.estimated_value > 0
       AND NOT EXISTS (SELECT 1 FROM dative_payments dp WHERE dp.dative_case_id = dc.id)
     ORDER BY dc.nomeacao_date DESC LIMIT 300`) as any;
  for (const r of datCasos) rows.push({
    fonte: 'dativo_caso', id: r.id,
    descricao: `Nomeação — ${r.assisted_name || 'assistido'} (${r.comarca}${r.process_number ? ' · ' + r.process_number : ''})`,
    cliente: 'Estado (dativo)', processo: r.process_number || null, valor: N(r.estimated_value), vencimento: null, recebido: false, pago_em: null,
  });

  const [corr] = await db.query(`
    SELECT id, payer_name, process_number, value, due_date, paid_at, status
      FROM correspondent_hearings WHERE status IN ('agendada','realizada','faturada','paga')
     ORDER BY due_date DESC LIMIT 300`) as any;
  for (const r of corr) rows.push({
    fonte: 'correspondente', id: r.id, descricao: `Audiência — ${r.payer_name || '—'}${r.process_number ? ' (' + r.process_number + ')' : ''}`,
    cliente: r.payer_name || '—', processo: r.process_number || null, valor: N(r.value), vencimento: r.due_date, recebido: r.status === 'paga', pago_em: r.paid_at,
  });

  const KIND_PT: Record<string, string> = { rpv: 'RPV', precatorio: 'Precatório', alvara: 'Alvará', acordo: 'Acordo', outro: 'Êxito' };
  const [aw] = await db.query(`
    SELECT a.id, a.kind, a.descricao, a.valor_escritorio, a.previsao_pagamento, a.data_recebimento, a.status,
           cl.name AS client_name, c.case_number, pt.name AS pt_nome, pt.partner_split_percent AS pt_split, pt.sucumbencia_split_percent AS pt_sucumb, pt.entry_split AS pt_entry
      FROM case_awards a
      LEFT JOIN clients cl ON cl.id = a.client_id
      LEFT JOIN cases c ON c.id = a.case_id
      LEFT JOIN partners pt ON pt.id = c.partner_id
     WHERE a.status IN ('aguardando','recebido')
     ORDER BY COALESCE(a.previsao_pagamento, a.data_recebimento) DESC LIMIT 300`).catch(() => [[]]) as any;
  for (const r of aw) rows.push({
    fonte: 'exito', id: r.id,
    descricao: `${KIND_PT[r.kind] || r.kind}${r.descricao ? ' — ' + r.descricao : ''}${r.case_number ? ' (proc. ' + r.case_number + ')' : ''}`,
    cliente: r.client_name || '—', processo: r.case_number || null, valor: N(r.valor_escritorio), vencimento: r.previsao_pagamento,
    recebido: r.status === 'recebido', pago_em: r.data_recebimento, _parceria: parceria(r),
  });

  const { marcarVencidos, separarParceiro } = await import('./aReceberFiltro');
  marcarVencidos(rows, hoje); // vencimento vem como Date do MySQL — comparar em ISO
  for (const r of rows) { Object.assign(r, separarParceiro(r, r._parceria || null)); delete r._parceria; }
  rows.sort((a, b) => String(a.vencimento || '').localeCompare(String(b.vencimento || '')));
  return rows;
}
