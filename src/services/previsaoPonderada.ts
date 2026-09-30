/**
 * Previsão de receita ponderada — regras puras.
 *  - Mês: já recebido + a receber contratado × taxa histórica de recebimento
 *    (quanto do que venceu nos últimos 90 dias foi de fato pago).
 *  - Pipeline (novos contratos): valor de cada proposta em aberto × chance de
 *    fechar — a probabilidade informada no lead, ou a taxa histórica de aceite.
 * O pipeline é mostrado à parte: proposta aceita não vira caixa no mesmo mês.
 */

const TAXA_ACEITE_SEM_HISTORICO = 0.3;
const arred = (n: number) => Math.round(n * 100) / 100;

/** recebido/devido, limitado a 0..1; sem histórico = 1 (não penaliza). */
export function taxa(recebido: number, devido: number): number {
  if (!devido) return 1;
  return Math.max(0, Math.min(1, recebido / devido));
}

export interface EntradaPrevisao {
  realizado: number;
  aReceber: number;
  recebidoHist: number;
  devidoHist: number;
  propostas: { valor: number; prob: number | null }[];
  aceitasHist: number;
  decididasHist: number;
}

export function preverMes(e: EntradaPrevisao) {
  const taxaRecebimento = taxa(e.recebidoHist, e.devidoHist);
  const taxaConversao = e.decididasHist ? e.aceitasHist / e.decididasHist : TAXA_ACEITE_SEM_HISTORICO;
  const pipelinePonderado = e.propostas.reduce((s, p) => {
    const chance = p.prob === null || p.prob === undefined ? taxaConversao : Math.max(0, Math.min(100, Number(p.prob))) / 100;
    return s + Number(p.valor || 0) * chance;
  }, 0);
  return {
    realizado: arred(e.realizado),
    aReceber: arred(e.aReceber),
    taxaRecebimento: arred(taxaRecebimento),
    previsaoMes: arred(e.realizado + e.aReceber * taxaRecebimento),
    otimista: arred(e.realizado + e.aReceber),
    taxaConversao: arred(taxaConversao),
    pipelineBruto: arred(e.propostas.reduce((s, p) => s + Number(p.valor || 0), 0)),
    pipelinePonderado: arred(pipelinePonderado),
    propostasAbertas: e.propostas.length,
  };
}
