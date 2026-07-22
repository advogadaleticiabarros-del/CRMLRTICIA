import { db } from '../config/database';

/**
 * Fonte ÚNICA de verdade para "quanto entrou/vai entrar", usada por TODOS os
 * relatórios (DRE do contador, Relatório Executivo, projeção de caixa,
 * painel do Dashboard). Antes cada endpoint tinha sua própria query — foram
 * divergindo com o tempo (alguns esqueciam dativo/correspondente, outros
 * esqueciam a tabela `parcelas` ou os êxitos de `case_awards`, um ainda
 * filtrava por usuário). Centralizar aqui impede que voltem a divergir.
 */

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const N = (x: any) => Number(x) || 0;

export interface ReceitasMes {
  parcelas_contratos: number;   // installments (propostas) + parcelas (contratos)
  avulsas_clientes: number;     // financial_records receita de cliente próprio (sem parceiro)
  entradas_parceria: number;    // financial_records receita ligada a caso de PARCERIA (entrada/êxito/sucumbência)
  dativo: number;
  correspondente: number;
  exitos: number;               // case_awards (RPV/precatório/alvará/acordo) recebidos
  total: number;
}

/** Receita efetivamente RECEBIDA (regime de caixa) num mês específico, por origem. */
export async function getReceitasRecebidasNoMes(month: string): Promise<ReceitasMes> {
  const one = async (sql: string, params: any[] = []) => { const [[r]] = await db.query(sql, params) as any; return r; };

  const inst = await one(`SELECT COALESCE(SUM(valor),0) AS v FROM installments WHERE status='pago' AND DATE_FORMAT(paid_at,'%Y-%m') = ?`, [month]);
  const parc = await one(`SELECT COALESCE(SUM(valor_final),0) AS v FROM parcelas WHERE status='pago' AND DATE_FORMAT(data_pagamento,'%Y-%m') = ?`, [month]).catch(() => ({ v: 0 }));
  // Parceria = caso vinculado tem partner_id, OU (fallback p/ lançamentos
  // antigos sem case_id) descrição começa com "Entrada parceria". Um JOIN
  // puro por case_id classificaria errado registros legados sem caso
  // vinculado (existe pelo menos 1 em produção — entrada de cliente com
  // vários protocolos, lançada sem o case_id de referência).
  const ehParceria = "(c.partner_id IS NOT NULL OR (fr.case_id IS NULL AND fr.description LIKE 'Entrada parceria%'))";
  const avulsasCli = await one(`
    SELECT COALESCE(SUM(fr.valor),0) AS v FROM financial_records fr LEFT JOIN cases c ON c.id = fr.case_id
     WHERE fr.tipo='receita' AND fr.status='pago' AND NOT ${ehParceria}
       AND DATE_FORMAT(COALESCE(fr.paid_at, fr.due_date),'%Y-%m') = ?`, [month]);
  const parceria = await one(`
    SELECT COALESCE(SUM(fr.valor),0) AS v FROM financial_records fr LEFT JOIN cases c ON c.id = fr.case_id
     WHERE fr.tipo='receita' AND fr.status='pago' AND ${ehParceria}
       AND DATE_FORMAT(COALESCE(fr.paid_at, fr.due_date),'%Y-%m') = ?`, [month]);
  const dativo = await one(`SELECT COALESCE(SUM(value),0) AS v FROM dative_payments WHERE status='recebido' AND DATE_FORMAT(received_date,'%Y-%m') = ?`, [month]);
  const correspondente = await one(`SELECT COALESCE(SUM(value),0) AS v FROM correspondent_hearings WHERE status='paga' AND DATE_FORMAT(paid_at,'%Y-%m') = ?`, [month]);
  const exitos = await one(`SELECT COALESCE(SUM(valor_escritorio),0) AS v FROM case_awards WHERE status='recebido' AND DATE_FORMAT(data_recebimento,'%Y-%m') = ?`, [month]).catch(() => ({ v: 0 }));

  const parcelas_contratos = round2(N(inst.v) + N(parc.v));
  const avulsas_clientes = round2(N(avulsasCli.v));
  const entradas_parceria = round2(N(parceria.v));
  const dativoV = round2(N(dativo.v));
  const correspondenteV = round2(N(correspondente.v));
  const exitosV = round2(N(exitos.v));

  return {
    parcelas_contratos, avulsas_clientes, entradas_parceria,
    dativo: dativoV, correspondente: correspondenteV, exitos: exitosV,
    total: round2(parcelas_contratos + avulsas_clientes + entradas_parceria + dativoV + correspondenteV + exitosV),
  };
}

/** Receita RECEBIDA no ano inteiro (mesmas fontes, granularidade anual). */
export async function getReceitasRecebidasNoAno(year: number): Promise<number> {
  const one = async (sql: string, params: any[] = []) => { const [[r]] = await db.query(sql, params) as any; return N(r.v); };
  const inst = await one(`SELECT COALESCE(SUM(valor),0) AS v FROM installments WHERE status='pago' AND YEAR(paid_at) = ?`, [year]);
  const parc = await one(`SELECT COALESCE(SUM(valor_final),0) AS v FROM parcelas WHERE status='pago' AND YEAR(data_pagamento) = ?`, [year]).catch(() => 0);
  const fr = await one(`SELECT COALESCE(SUM(valor),0) AS v FROM financial_records WHERE tipo='receita' AND status='pago' AND YEAR(COALESCE(paid_at, due_date)) = ?`, [year]);
  const dativo = await one(`SELECT COALESCE(SUM(value),0) AS v FROM dative_payments WHERE status='recebido' AND YEAR(received_date) = ?`, [year]);
  const correspondente = await one(`SELECT COALESCE(SUM(value),0) AS v FROM correspondent_hearings WHERE status='paga' AND YEAR(paid_at) = ?`, [year]);
  const exitos = await one(`SELECT COALESCE(SUM(valor_escritorio),0) AS v FROM case_awards WHERE status='recebido' AND YEAR(data_recebimento) = ?`, [year]).catch(() => 0);
  return round2(inst + parc + fr + dativo + correspondente + exitos);
}

export interface JanelaCaixa { entradas: number; saidas: number; saldo: number }

/** Fluxo de caixa PREVISTO numa janela de dias a partir de hoje (todas as fontes). */
export async function getJanelaFluxoCaixa(deDias: number, ateDias: number): Promise<JanelaCaixa> {
  const [[e]] = await db.query(`
    SELECT
      COALESCE((SELECT SUM(valor) FROM installments
               WHERE status IN ('pendente','em_processamento')
                 AND due_date BETWEEN DATE_ADD(CURDATE(), INTERVAL ? DAY) AND DATE_ADD(CURDATE(), INTERVAL ? DAY)),0)
    + COALESCE((SELECT SUM(valor_final) FROM parcelas
               WHERE status IN ('aberto','atrasado','parcial')
                 AND data_vencimento BETWEEN DATE_ADD(CURDATE(), INTERVAL ? DAY) AND DATE_ADD(CURDATE(), INTERVAL ? DAY)),0)
    + COALESCE((SELECT SUM(valor) FROM financial_records
               WHERE tipo='receita' AND status='pendente'
                 AND due_date BETWEEN DATE_ADD(CURDATE(), INTERVAL ? DAY) AND DATE_ADD(CURDATE(), INTERVAL ? DAY)),0)
    + COALESCE((SELECT SUM(value) FROM dative_payments
               WHERE status='previsto'
                 AND expected_date BETWEEN DATE_ADD(CURDATE(), INTERVAL ? DAY) AND DATE_ADD(CURDATE(), INTERVAL ? DAY)),0)
    + COALESCE((SELECT SUM(value) FROM correspondent_hearings
               WHERE status IN ('agendada','realizada','faturada')
                 AND due_date BETWEEN DATE_ADD(CURDATE(), INTERVAL ? DAY) AND DATE_ADD(CURDATE(), INTERVAL ? DAY)),0)
    + COALESCE((SELECT SUM(valor_escritorio) FROM case_awards
               WHERE status='aguardando'
                 AND previsao_pagamento BETWEEN DATE_ADD(CURDATE(), INTERVAL ? DAY) AND DATE_ADD(CURDATE(), INTERVAL ? DAY)),0) AS entradas,
      COALESCE((SELECT SUM(valor) FROM financial_records
               WHERE tipo='despesa' AND status='pendente'
                 AND due_date BETWEEN DATE_ADD(CURDATE(), INTERVAL ? DAY) AND DATE_ADD(CURDATE(), INTERVAL ? DAY)),0)
    + COALESCE((SELECT SUM(valor) FROM repasses
               WHERE status IN ('pendente','processando')
                 AND data_vencimento BETWEEN DATE_ADD(CURDATE(), INTERVAL ? DAY) AND DATE_ADD(CURDATE(), INTERVAL ? DAY)),0) AS saidas
  `, [deDias, ateDias, deDias, ateDias, deDias, ateDias, deDias, ateDias, deDias, ateDias, deDias, ateDias, deDias, ateDias]) as any;
  const entradas = N(e.entradas), saidas = N(e.saidas);
  return { entradas: round2(entradas), saidas: round2(saidas), saldo: round2(entradas - saidas) };
}

export interface Inadimplencia { ate_30: number; de_31_60: number; mais_60: number; total: number }

/** O que está VENCIDO e não recebido, em todas as fontes com data de vencimento. */
export async function getInadimplencia(): Promise<Inadimplencia> {
  const [[r]] = await db.query(`
    SELECT
      COALESCE((SELECT SUM(valor) FROM financial_records WHERE tipo='receita' AND status IN ('pendente','vencido') AND due_date < CURDATE() AND DATEDIFF(CURDATE(),due_date) BETWEEN 1 AND 30),0)
    + COALESCE((SELECT SUM(valor) FROM installments WHERE status IN ('pendente','vencido') AND due_date < CURDATE() AND DATEDIFF(CURDATE(),due_date) BETWEEN 1 AND 30),0)
    + COALESCE((SELECT SUM(valor_final) FROM parcelas WHERE status IN ('aberto','atrasado') AND data_vencimento < CURDATE() AND DATEDIFF(CURDATE(),data_vencimento) BETWEEN 1 AND 30),0) AS ate_30,
      COALESCE((SELECT SUM(valor) FROM financial_records WHERE tipo='receita' AND status IN ('pendente','vencido') AND due_date < CURDATE() AND DATEDIFF(CURDATE(),due_date) BETWEEN 31 AND 60),0)
    + COALESCE((SELECT SUM(valor) FROM installments WHERE status IN ('pendente','vencido') AND due_date < CURDATE() AND DATEDIFF(CURDATE(),due_date) BETWEEN 31 AND 60),0)
    + COALESCE((SELECT SUM(valor_final) FROM parcelas WHERE status IN ('aberto','atrasado') AND data_vencimento < CURDATE() AND DATEDIFF(CURDATE(),data_vencimento) BETWEEN 31 AND 60),0) AS de_31_60,
      COALESCE((SELECT SUM(valor) FROM financial_records WHERE tipo='receita' AND status IN ('pendente','vencido') AND due_date < CURDATE() AND DATEDIFF(CURDATE(),due_date) > 60),0)
    + COALESCE((SELECT SUM(valor) FROM installments WHERE status IN ('pendente','vencido') AND due_date < CURDATE() AND DATEDIFF(CURDATE(),due_date) > 60),0)
    + COALESCE((SELECT SUM(valor_final) FROM parcelas WHERE status IN ('aberto','atrasado') AND data_vencimento < CURDATE() AND DATEDIFF(CURDATE(),data_vencimento) > 60),0) AS mais_60
  `) as any;
  const ate_30 = round2(N(r.ate_30)), de_31_60 = round2(N(r.de_31_60)), mais_60 = round2(N(r.mais_60));
  return { ate_30, de_31_60, mais_60, total: round2(ate_30 + de_31_60 + mais_60) };
}
