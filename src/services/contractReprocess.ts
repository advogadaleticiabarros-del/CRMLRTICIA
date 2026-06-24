import { db } from '../config/database';
import { buildTemplate, buildProcuracao, buildDeclaracao, montarEndereco, formaPagamentoTexto, PartyData } from './contractTemplates';
import { getEscritorio } from './escritorio';

const AREAS = ['trabalhista', 'gestante', 'familia', 'civel', 'previdenciario', 'consumidor', 'outro'];

/** Regenera os 3 documentos de um contrato a partir dos dados atuais (lead + cliente + proposta + escritório). */
export async function reprocessContract(contractId: number, userId?: number): Promise<boolean> {
  const [cts] = await db.query(
    userId ? 'SELECT * FROM contracts WHERE id = ? AND user_id = ?' : 'SELECT * FROM contracts WHERE id = ?',
    userId ? [contractId, userId] : [contractId]
  ) as any;
  if (!cts.length) return false;
  const ct = cts[0];

  let lead: any = null, client: any = null, prop: any = null;
  if (ct.lead_id) {
    const [lr] = await db.query('SELECT name, cpf_cnpj, rg, marital_status, profession, cep, street, number, neighborhood, city, state, phone, email, legal_area, case_summary FROM leads WHERE id = ?', [ct.lead_id]) as any;
    lead = lr[0] || null;
  }
  if (ct.client_id) {
    const [cr] = await db.query('SELECT name, cpf_cnpj, address, phone, email FROM clients WHERE id = ?', [ct.client_id]) as any;
    client = cr[0] || null;
  }
  const [pr] = await db.query(
    'SELECT tipo_causa, description, legal_area, valor, honorarios FROM propostas WHERE (lead_id <=> ? OR client_id <=> ?) ORDER BY created_at DESC LIMIT 1',
    [ct.lead_id ?? null, ct.client_id ?? null]
  ) as any;
  prop = pr[0] || null;

  const nome = client?.name || lead?.name || '';
  const cpf = client?.cpf_cnpj || lead?.cpf_cnpj || null;
  const endereco = (client?.address && client.address.trim()) ? client.address : (montarEndereco(lead || {}) || null);
  const party: PartyData = {
    name: nome, cpf, estadoCivil: lead?.marital_status, profissao: lead?.profession, endereco,
    email: client?.email || lead?.email, phone: client?.phone || lead?.phone,
  };
  const area = AREAS.includes(ct.area) ? ct.area : (AREAS.includes(prop?.legal_area) ? prop.legal_area : (AREAS.includes(lead?.legal_area) ? lead.legal_area : 'outro'));

  let honorarios: any = null, parcelamento: any = null, valor = Number(ct.value) || Number(prop?.valor) || undefined;
  try {
    honorarios = typeof prop?.honorarios === 'string' ? JSON.parse(prop.honorarios) : prop?.honorarios;
    if (honorarios?.parcelamento && Number(honorarios.parcelamento.total) > 0) { parcelamento = honorarios.parcelamento; valor = Number(honorarios.parcelamento.total); }
  } catch {}

  const adv = await getEscritorio();
  const content = buildTemplate({ party, area, value: valor, formaPagamento: formaPagamentoTexto(parcelamento), honorarios, tipoCausa: prop?.tipo_causa, descricao: prop?.description || lead?.case_summary, contratada: adv });
  await db.query(
    'UPDATE contracts SET content = ?, procuracao_content = ?, declaracao_content = ?, value = COALESCE(?, value) WHERE id = ?',
    [content, buildProcuracao(party, adv), buildDeclaracao(party), valor ?? null, contractId]
  );
  return true;
}

export async function reprocessAllContracts(): Promise<number> {
  const [rows] = await db.query('SELECT id FROM contracts') as any;
  let n = 0;
  for (const r of rows) { try { if (await reprocessContract(r.id)) n++; } catch { /* ignora um contrato com erro */ } }
  return n;
}
