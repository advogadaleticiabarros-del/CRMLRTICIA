import { ExecutiveReportData } from './executiveReport';

/** Mês anterior de um "AAAA-MM" qualquer (não só o mês corrente). */
export function prevMonthOf(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export interface Delta { pct: number | null; alta: boolean }

/** Variação percentual entre dois valores — null quando não dá pra comparar (base zero). */
export function delta(atual: number, anterior: number): Delta {
  if (!anterior) return { pct: null, alta: atual > 0 };
  const pct = Math.round(((atual - anterior) / Math.abs(anterior)) * 1000) / 10;
  return { pct, alta: pct >= 0 };
}

export interface Narrative { resumo: string; destaques: string[]; dicas: string[] }

const mesLabel = (ym: string) => {
  const [y, m] = ym.split('-');
  return ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][Number(m) - 1] + '/' + y;
};
const money = (n: number) => `R$ ${(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
const pctBR = (n: number) => Math.abs(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

/**
 * Resumo do mês (manchete financeira) + destaques (fatos soltos, um por
 * linha — mais fácil de escanear que um parágrafo só) + dicas acionáveis,
 * geradas a partir dos números (sem IA — regras simples e transparentes,
 * fáceis de ajustar). Compara com o mês anterior quando existe base pra isso.
 */
export function buildNarrative(cur: ExecutiveReportData, prev: ExecutiveReportData | null): Narrative {
  const dRec = prev ? delta(cur.receita_total, prev.receita_total) : null;
  const dRes = prev ? delta(cur.resultado, prev.resultado) : null;

  const variacao = (d: Delta | null) =>
    d && d.pct !== null ? ` (${d.alta ? 'alta' : 'queda'} de ${pctBR(d.pct)}% frente ao mês anterior)` : '';

  const resumo =
    `Em ${mesLabel(cur.month)}, o escritório faturou ${money(cur.receita_total)}${variacao(dRec)}, ` +
    `fechando com resultado de ${money(cur.resultado)}${cur.resultado >= 0 ? '' : ' (negativo)'}${variacao(dRes)}.`;

  const destaques: string[] = [
    `${cur.processos.total_protocolados} processo(s) protocolado(s) — ${cur.processos.proprios} próprio(s) · ${cur.processos.parcerias} de parceria`,
    `${cur.processos.movimentacoes_total} movimentação(ões) processual(is) recebida(s), em ${cur.processos.processos_com_movimentacao} processo(s)`,
    `${cur.agenda.compromissos_total} compromisso(s) na agenda`,
    `${cur.funil.leads_novos} lead(s) novo(s) · ${cur.funil.propostas_aceitas} proposta(s) aceita(s) (${cur.funil.conversao_pct}% de conversão)`,
  ];

  const dicas: string[] = [];

  if (cur.resultado < 0) {
    dicas.push('O mês fechou no negativo — vale revisar a lista de despesas fixas em Contas a Pagar e ver o que dá pra renegociar ou cortar.');
  } else if (dRes && dRes.pct !== null && dRes.alta && dRes.pct >= 15) {
    dicas.push(`O resultado cresceu ${pctBR(dRes.pct)}% frente ao mês anterior — bom momento para revisar se algum canal específico puxou esse ganho e reforçar nele.`);
  }

  if (cur.situacao_atual.inadimplencia > 0 && cur.receita_total > 0 && cur.situacao_atual.inadimplencia > cur.receita_total * 0.3) {
    dicas.push(`A inadimplência acumulada (${money(cur.situacao_atual.inadimplencia)}) já passa de 30% da receita do mês — vale priorizar a régua de cobrança antes que cresça mais.`);
  }

  if (cur.funil.leads_novos >= 5 && cur.funil.conversao_pct < 15) {
    dicas.push(`A conversão do funil está em ${cur.funil.conversao_pct}% com ${cur.funil.leads_novos} leads no mês — considere revisar o follow-up das propostas enviadas e não respondidas.`);
  }

  if (cur.producao.entraram_esteira > 0 && cur.producao.recusados / cur.producao.entraram_esteira > 0.3) {
    dicas.push(`${cur.producao.recusados} de ${cur.producao.entraram_esteira} casos que entraram na esteira foram recusados após análise — pode valer revisar o critério de triagem inicial pra evitar retrabalho.`);
  }

  if (cur.processos.total_protocolados === 0 && cur.producao.entraram_esteira > 0) {
    dicas.push('Nenhum processo foi protocolado este mês apesar de casos terem entrado na esteira de produção — vale checar se algum está parado.');
  }

  if (!dicas.length) {
    dicas.push('Sem alertas — os números do mês estão dentro do esperado.');
  }

  return { resumo, destaques, dicas };
}
