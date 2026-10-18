import { db } from '../config/database';
import { montarAReceber } from './aReceberMontar';
import { relacoes, resumoFinanceiro, alertas, linhaDoTempo, termoDeBusca } from './visaoCliente';

/**
 * Visão completa do cliente com banco (regras em visaoCliente.ts).
 * Cada consulta é isolada: se uma tabela falhar, o resto aparece.
 * O financeiro usa a MESMA conta da tela A Receber (montarAReceber com filtro),
 * para os números baterem com os do Financeiro.
 */

async function q<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  try { const [r] = await db.query(sql, params) as any; return r as T[]; } catch (e: any) { console.error('[visao-cliente]', e?.message); return []; }
}
const lista = (ids: number[]) => (ids.length ? ids.join(',') : '0');
const hojeBrt = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);

/** Busca da página inicial: nome, CPF, telefone, nº de processo (cível, trabalhista, dativo) e nome do assistido. */
export async function buscarClientes(entrada: string) {
  const { texto, digitos } = termoDeBusca(entrada);
  if (texto.length < 2) return [];
  const contem = `%${texto}%`;
  const achados = new Map<number, { id: number; name: string; cpf_cnpj: string | null; phone: string | null; motivo: string }>();
  const add = (rows: any[], motivo: (r: any) => string) => { for (const r of rows) if (r.id && !achados.has(r.id)) achados.set(r.id, { id: r.id, name: r.name, cpf_cnpj: r.cpf_cnpj, phone: r.phone, motivo: motivo(r) }); };

  add(await q('SELECT id, name, cpf_cnpj, phone FROM clients WHERE name LIKE ? ORDER BY (name LIKE ?) DESC, name LIMIT 12', [contem, `${texto}%`]), () => 'nome');
  if (digitos.length >= 4) {
    add(await q("SELECT id, name, cpf_cnpj, phone FROM clients WHERE REGEXP_REPLACE(COALESCE(cpf_cnpj,''), '[^0-9]', '') LIKE ? LIMIT 5", [`%${digitos}%`]), () => 'CPF/CNPJ');
    add(await q("SELECT id, name, cpf_cnpj, phone FROM clients WHERE REGEXP_REPLACE(COALESCE(phone,''), '[^0-9]', '') LIKE ? LIMIT 5", [`%${digitos}%`]), () => 'telefone');
  }
  if (digitos.length >= 5) {
    const d = `%${digitos}%`;
    add(await q(`SELECT cl.id, cl.name, cl.cpf_cnpj, cl.phone, lp.process_number AS n FROM legal_processes lp JOIN clients cl ON cl.id = lp.client_id
                  WHERE REGEXP_REPLACE(lp.process_number, '[^0-9]', '') LIKE ? LIMIT 5`, [d]), (r) => `processo ${r.n}`);
    add(await q(`SELECT cl.id, cl.name, cl.cpf_cnpj, cl.phone, c.case_number AS n FROM cases c JOIN clients cl ON cl.id = c.client_id
                  WHERE REGEXP_REPLACE(COALESCE(c.case_number,''), '[^0-9]', '') LIKE ? LIMIT 5`, [d]), (r) => `processo ${r.n}`);
    add(await q(`SELECT cl.id, cl.name, cl.cpf_cnpj, cl.phone, dc.process_number AS n FROM dative_cases dc JOIN clients cl ON cl.id = dc.client_id
                  WHERE REGEXP_REPLACE(COALESCE(dc.process_number,''), '[^0-9]', '') LIKE ? LIMIT 5`, [d]), (r) => `dativo ${r.n}`);
  }
  add(await q(`SELECT cl.id, cl.name, cl.cpf_cnpj, cl.phone FROM dative_cases dc JOIN clients cl ON cl.id = dc.client_id WHERE dc.assisted_name LIKE ? LIMIT 5`, [contem]), () => 'assistido (dativo)');
  return [...achados.values()].slice(0, 15);
}

export async function montarVisao(clientId: number) {
  const [cliente] = await q('SELECT * FROM clients WHERE id = ?', [clientId]);
  if (!cliente) return null;
  const hoje = hojeBrt();

  const [lead] = await q('SELECT id, rg, marital_status, profession, case_summary, legal_area FROM leads WHERE client_id = ? ORDER BY id DESC LIMIT 1', [clientId]);
  const casos = await q(
    `SELECT c.id, c.title, c.case_number, c.legal_area, c.phase, c.status, c.production_stage, c.partner_id, p.name AS partner_name,
            c.valor_causa, c.resultado, c.valor_obtido, c.created_at
       FROM cases c LEFT JOIN partners p ON p.id = c.partner_id WHERE c.client_id = ? ORDER BY c.created_at DESC`, [clientId]);
  const idsCasos = casos.map((c: any) => Number(c.id));
  const dativos = await q(
    `SELECT id, process_number, comarca, vara, area, assunto, status, nomeacao_date, estimated_value, arbitrated_value, case_id, legal_process_id, assisted_name
       FROM dative_cases WHERE client_id = ? ORDER BY nomeacao_date DESC`, [clientId]);
  const idsDativos = dativos.map((d: any) => Number(d.id));

  const processos = await q(
    `SELECT id, process_number, court, court_alias, judicial_area, status, phase, case_id, last_movement_at, monitoring_enabled
       FROM legal_processes WHERE client_id = ? OR case_id IN (${lista(idsCasos)}) ORDER BY last_movement_at DESC`, [clientId]);
  const idsProcessos = processos.map((p: any) => Number(p.id));

  const [movProc, movCaso, prazos, eventos, audDativo, acordos, receitasParceiro, propostas, contratos, documentos, registros, whatsapp] = await Promise.all([
    q(`SELECT pm.id, lp.process_number, COALESCE(pm.movement_date, pm.created_at) AS data,
              COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pm.ai_summary, '$.resumo')), pm.title, pm.description) AS description
         FROM process_movements pm JOIN legal_processes lp ON lp.id = pm.process_id
        WHERE pm.process_id IN (${lista(idsProcessos)}) ORDER BY data DESC LIMIT 40`),
    q(`SELECT cm.id, c.case_number AS process_number, COALESCE(cm.movement_date, cm.created_at) AS data, cm.description
         FROM case_movements cm LEFT JOIN cases c ON c.id = cm.case_id
        WHERE cm.client_id = ? OR cm.case_id IN (${lista(idsCasos)}) ORDER BY data DESC LIMIT 20`, [clientId]),
    q(`SELECT id, description, deadline_date, status, priority, case_id FROM deadlines
        WHERE client_id = ? OR case_id IN (${lista(idsCasos)}) ORDER BY deadline_date DESC LIMIT 60`, [clientId]),
    q(`SELECT id, title, event_type, start_datetime, location, status FROM calendar_events
        WHERE (client_id = ? OR case_id IN (${lista(idsCasos)})) AND COALESCE(sync_status, '') <> 'cancelado'
        ORDER BY start_datetime DESC LIMIT 40`, [clientId]),
    q(`SELECT dh.id, dh.hearing_date, dh.type, dh.comarca, dh.status, dh.act_value, dc.process_number FROM dative_hearings dh
         JOIN dative_cases dc ON dc.id = dh.dative_case_id WHERE dh.dative_case_id IN (${lista(idsDativos)}) ORDER BY dh.hearing_date DESC`),
    q(`SELECT id, case_id, process_number, opposing_party, total_agreement_value, installments_count, honorarium_value, honorarium_percentage,
              status, is_extrajudicial, first_due_date, entrada_value
         FROM agreements WHERE client_id = ? OR case_id IN (${lista(idsCasos)}) ORDER BY created_at DESC`, [clientId]),
    q(`SELECT id, case_id, parceiro, tipo, valor, status, data_vencimento, data_repasse FROM repasses WHERE case_id IN (${lista(idsCasos)}) ORDER BY data_vencimento DESC`),
    q('SELECT id, title, valor, status, created_at, aceito_em, legal_area FROM propostas WHERE client_id = ? ORDER BY created_at DESC', [clientId]),
    q('SELECT id, title, area, value, status, created_at FROM contracts WHERE client_id = ? ORDER BY created_at DESC', [clientId]),
    q('SELECT id, name, folder, type, status, created_at FROM documents WHERE client_id = ? ORDER BY created_at DESC LIMIT 60', [clientId]),
    q('SELECT description, created_at FROM client_timeline WHERE client_id = ? ORDER BY created_at DESC LIMIT 40', [clientId]),
    q(`SELECT body, from_me, msg_time FROM whatsapp_messages
        WHERE ? <> '' AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 8) = ? ORDER BY msg_time DESC LIMIT 3`,
      [String(cliente.phone || '').replace(/\D/g, '').slice(-8), String(cliente.phone || '').replace(/\D/g, '').slice(-8)]),
  ]);

  const idsAcordos = acordos.map((a: any) => Number(a.id));
  const repassesCliente = await q(
    `SELECT id, agreement_id, tranche_label, valor_bruto, valor_honorarios, valor_liquido, status, data_prevista, data_repasse
       FROM agreement_client_payouts WHERE agreement_id IN (${lista(idsAcordos)}) ORDER BY data_prevista ASC`);
  const lancamentos = await montarAReceber({ clientId }).catch(() => []);
  const pagamentosDativo = await q(`SELECT id, reference, value, expected_date, received_date, status FROM dative_payments WHERE dative_case_id IN (${lista(idsDativos)})`);

  const audiencias = [
    ...eventos.filter((e: any) => e.event_type === 'audiencia').map((e: any) => ({ titulo: e.title || 'Audiência', data: e.start_datetime, local: e.location })),
    ...audDativo.map((h: any) => ({ titulo: `Audiência dativa${h.type ? ` (${h.type})` : ''}${h.process_number ? ` · ${h.process_number}` : ''}`, data: h.hearing_date, local: h.comarca })),
  ];
  const naoDativo = lancamentos.filter((r: any) => !String(r.fonte).startsWith('dativo'));
  const financeiro = resumoFinanceiro({
    // A parte da Dra. (em parceria, sem a do parceiro), como na tela A Receber.
    parcelas: naoDativo.map((r: any) => ({ valor: r.seu ?? r.valor, status: r.recebido ? 'pago' : 'pendente', due_date: r.vencimento })),
    receitas: [], acordos, repassesCliente, pagamentosDativo, repassesParceiro: receitasParceiro,
  }, hoje);
  const parteParceiro = Math.round(naoDativo.filter((r: any) => !r.recebido).reduce((s: number, r: any) => s + (Number(r.parceiro) || 0), 0) * 100) / 100;

  const movimentacoes = [...movProc, ...movCaso];
  return {
    cliente: {
      id: cliente.id, name: cliente.name, tipo: cliente.tipo, cpf_cnpj: cliente.cpf_cnpj, email: cliente.email, phone: cliente.phone,
      address: cliente.address, status: cliente.status, notes: cliente.notes, areas: cliente.areas, birth_date: cliente.birth_date,
      rg: lead?.rg || null, estado_civil: lead?.marital_status || null, profissao: lead?.profession || null, resumo: lead?.case_summary || null,
      lgpd: !!cliente.lgpd_consent_at, created_at: cliente.created_at,
    },
    relacoes: relacoes({ isDative: cliente.is_dative, dativos, casos, processos }),
    alertas: alertas({ prazos, parcelas: naoDativo.map((r: any) => ({ valor: r.seu ?? r.valor, status: r.recebido ? 'pago' : 'pendente', due_date: r.vencimento })), repassesCliente, audiencias }, hoje),
    financeiro: { ...financeiro, parteParceiroAReceber: parteParceiro },
    casos, processos, dativos, pagamentosDativo, acordos, repassesCliente, repassesParceiro: receitasParceiro,
    lancamentos: lancamentos.slice(0, 80), prazos, audiencias, movimentacoes: movimentacoes.slice(0, 40),
    propostas, contratos, documentos, whatsapp,
    linhaDoTempo: linhaDoTempo({
      movimentacoes, prazos, audiencias,
      pagamentos: lancamentos.filter((r: any) => r.recebido && r.pago_em).map((r: any) => ({ data: r.pago_em, texto: `Recebido: ${r.descricao} · R$ ${Number(r.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` })),
      registros,
    }),
  };
}
