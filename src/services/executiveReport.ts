import { db } from '../config/database';
import { getReceitasRecebidasNoMes, getInadimplencia } from './monthlyFinance';

/**
 * Fonte única do Relatório Executivo mensal — usada pela tela (Financeiro →
 * Visão Geral → "Relatório executivo") E pelo e-mail automático do dia 1.
 * Antes só existia em src/routes/dashboards/relatorioMensal.ts; extraído pra
 * cá pra não duplicar a query quando o e-mail passou a existir.
 */

const N = (x: any) => Number(x) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
const one = async (sql: string, params: any[] = []) => { const [[row]] = await db.query(sql, params) as any; return row || {}; };

export interface Protocolado {
  case_number: string | null;
  client_name: string;
  legal_area: string;
  tipo: 'proprio' | 'parceria';
  data: string;
}

export interface ExecutiveReportData {
  month: string;
  receitas: { clientes: number; parcerias: number; dativo: number; correspondente: number; exitos: number };
  receita_total: number;
  saidas: {
    empresa: { despesas: number; repasses: number; total: number };
    pessoal: { despesas: number };
    total_geral: number;
  };
  resultado: number;
  processos: {
    protocolados: Protocolado[];
    total_protocolados: number;
    proprios: number;
    parcerias: number;
    movimentacoes_total: number;
    processos_com_movimentacao: number;
  };
  agenda: {
    compromissos_total: number;
    por_tipo: { tipo: string; total: number }[];
  };
  funil: {
    leads_novos: number; leads_fechados: number;
    propostas_criadas: number; propostas_aceitas: number; conversao_pct: number;
  };
  producao: { protocolados: number; entraram_esteira: number; recusados: number };
  situacao_atual: { inadimplencia: number; casos_na_esteira: number };
}

export async function getExecutiveReportData(month: string): Promise<ExecutiveReportData> {
  const rec = await getReceitasRecebidasNoMes(month);

  // Saídas pagas no mês (financial_records fica vazia em produção — despesas
  // reais da tela "Contas a Pagar" vivem em cashflow_entries). Separadas por
  // escopo — o "Resultado do mês" do escritório usa só "empresa"; "pessoal"
  // aparece à parte, só pra dar a soma total de tudo que saiu de casa.
  const sai = await one(`
    SELECT
      (SELECT COALESCE(SUM(valor),0) FROM financial_records WHERE tipo='despesa' AND status='pago' AND escopo='empresa' AND DATE_FORMAT(COALESCE(paid_at, due_date),'%Y-%m') = ?) AS despesas_fr_empresa,
      (SELECT COALESCE(SUM(amount),0) FROM cashflow_entries WHERE type='saida' AND status='realizado' AND escopo='empresa' AND DATE_FORMAT(COALESCE(paid_at, due_date),'%Y-%m') = ?) AS despesas_cf_empresa,
      (SELECT COALESCE(SUM(valor),0) FROM financial_records WHERE tipo='despesa' AND status='pago' AND escopo='pessoal' AND DATE_FORMAT(COALESCE(paid_at, due_date),'%Y-%m') = ?) AS despesas_fr_pessoal,
      (SELECT COALESCE(SUM(amount),0) FROM cashflow_entries WHERE type='saida' AND status='realizado' AND escopo='pessoal' AND DATE_FORMAT(COALESCE(paid_at, due_date),'%Y-%m') = ?) AS despesas_cf_pessoal,
      (SELECT COALESCE(SUM(valor),0) FROM repasses WHERE status='repassado' AND DATE_FORMAT(data_repasse,'%Y-%m') = ?) AS repasses
  `, [month, month, month, month, month]);

  // Funil comercial do mês
  const funil = await one(`
    SELECT
      (SELECT COUNT(*) FROM leads WHERE DATE_FORMAT(created_at,'%Y-%m') = ?) AS leads_novos,
      (SELECT COUNT(*) FROM leads WHERE status='fechada' AND DATE_FORMAT(updated_at,'%Y-%m') = ?) AS leads_fechados,
      (SELECT COUNT(*) FROM propostas WHERE DATE_FORMAT(created_at,'%Y-%m') = ?) AS propostas_criadas,
      (SELECT COUNT(*) FROM propostas WHERE status='aceita' AND DATE_FORMAT(COALESCE(aceito_em, updated_at),'%Y-%m') = ?) AS propostas_aceitas
  `, [month, month, month, month]);

  // Produção do mês
  const prod = await one(`
    SELECT
      (SELECT COUNT(*) FROM cases WHERE production_stage IS NOT NULL AND DATE_FORMAT(production_started_at,'%Y-%m') = ?) AS entraram_esteira,
      (SELECT COUNT(*) FROM cases WHERE production_stage = 'recusado' AND DATE_FORMAT(rejected_at,'%Y-%m') = ?) AS recusados
  `, [month, month]);

  // Processos protocolados no mês — número, cliente, área e se é caso próprio ou de parceria
  const [protocoladosRows] = await db.query(`
    SELECT c.case_number, cl.name AS client_name, c.legal_area, c.partner_id,
           DATE_FORMAT(ct.created_at, '%d/%m/%Y') AS data
      FROM client_timeline ct
      JOIN cases c ON c.id = ct.case_id
      JOIN clients cl ON cl.id = c.client_id
     WHERE ct.event_type = 'etapa_protocolado' AND DATE_FORMAT(ct.created_at,'%Y-%m') = ?
     ORDER BY ct.created_at ASC
  `, [month]) as any;
  const protocolados: Protocolado[] = protocoladosRows.map((p: any) => ({
    case_number: p.case_number, client_name: p.client_name, legal_area: p.legal_area,
    tipo: p.partner_id ? 'parceria' : 'proprio', data: p.data,
  }));

  // Movimentação processual do mês (DJEN) — volume total e quantos processos distintos mexeram
  const mov = await one(`
    SELECT COUNT(*) AS total, COUNT(DISTINCT case_id) AS processos
      FROM case_movements
     WHERE DATE_FORMAT(COALESCE(movement_date, created_at),'%Y-%m') = ?
  `, [month]);

  // Agenda do mês — quantos compromissos, por tipo
  const [agendaPorTipo] = await db.query(`
    SELECT event_type AS tipo, COUNT(*) AS total FROM calendar_events
     WHERE DATE_FORMAT(start_datetime,'%Y-%m') = ? GROUP BY event_type ORDER BY total DESC
  `, [month]) as any;
  const compromissosTotal = agendaPorTipo.reduce((s: number, r: any) => s + N(r.total), 0);

  // Situação atual (foto de hoje, não do mês)
  const [[esteira]] = await db.query(
    `SELECT COUNT(*) AS n FROM cases WHERE production_stage IN ('em_analise','separacao_documentos','criacao_inicial','revisao_inicial','aguardando_protocolo')`
  ) as any;
  const inadimplenciaAtual = await getInadimplencia();

  const receitas = {
    clientes: r2(rec.avulsas_clientes + rec.parcelas_contratos),
    parcerias: rec.entradas_parceria,
    dativo: rec.dativo,
    correspondente: rec.correspondente,
    exitos: rec.exitos,
  };
  const receita_total = rec.total;
  const despesasEmpresa = r2(N(sai.despesas_fr_empresa) + N(sai.despesas_cf_empresa));
  const despesasPessoal = r2(N(sai.despesas_fr_pessoal) + N(sai.despesas_cf_pessoal));
  const repasses = r2(N(sai.repasses));
  const totalEmpresa = r2(despesasEmpresa + repasses);
  const totalGeral = r2(totalEmpresa + despesasPessoal);

  return {
    month,
    receitas, receita_total,
    saidas: {
      empresa: { despesas: despesasEmpresa, repasses, total: totalEmpresa },
      pessoal: { despesas: despesasPessoal },
      total_geral: totalGeral,
    },
    resultado: r2(receita_total - totalEmpresa),
    processos: {
      protocolados,
      total_protocolados: protocolados.length,
      proprios: protocolados.filter((p) => p.tipo === 'proprio').length,
      parcerias: protocolados.filter((p) => p.tipo === 'parceria').length,
      movimentacoes_total: N(mov.total),
      processos_com_movimentacao: N(mov.processos),
    },
    agenda: {
      compromissos_total: compromissosTotal,
      por_tipo: agendaPorTipo.map((r: any) => ({ tipo: r.tipo, total: N(r.total) })),
    },
    funil: {
      leads_novos: N(funil.leads_novos), leads_fechados: N(funil.leads_fechados),
      propostas_criadas: N(funil.propostas_criadas), propostas_aceitas: N(funil.propostas_aceitas),
      conversao_pct: N(funil.leads_novos) ? Math.round((N(funil.leads_fechados) / N(funil.leads_novos)) * 100) : 0,
    },
    producao: { protocolados: protocolados.length, entraram_esteira: N(prod.entraram_esteira), recusados: N(prod.recusados) },
    situacao_atual: { inadimplencia: inadimplenciaAtual.total, casos_na_esteira: N(esteira.n) },
  };
}
