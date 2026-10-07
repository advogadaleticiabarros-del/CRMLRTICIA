/**
 * "Resultado por processo" — regras puras do relatório de resultados.
 *
 * Entra a lista de casos (com resultado, valor da causa, valor obtido e os
 * honorários já lançados); sai a taxa de sucesso, o % médio obtido sobre o
 * valor da causa e a PROVISÃO dos casos em andamento:
 *   provisão = valor da causa × taxa de sucesso × % médio obtido × honorário do caso
 * (honorário do caso = 30% próprio, ou a parte do escritório numa parceria).
 *
 * Fora da provisão: dativo (o valor vem do arbitramento, não do êxito) e
 * defesa (cliente ré — o ganho é economia, não valor recebido). Defesa conta
 * na taxa de sucesso, mas não entra no % obtido.
 */

export const RESULTADOS_SUCESSO = ['acordo', 'procedente', 'procedente_parcial'];
export const ehSucesso = (r: string | null | undefined) => RESULTADOS_SUCESSO.includes(String(r));

export interface CasoResultado {
  id: number;
  resultado: string | null;
  valor_causa: number | null;
  valor_obtido: number | null;
  polo_cliente: string | null;
  dativo: boolean;
  fee_pct: number;               // % de honorário que fica com o escritório
  honorarios_recebidos: number;
  honorarios_a_receber: number;
  repasse_parceiro: number;
  [extra: string]: unknown;      // dados de exibição (cliente, título…) passam direto
}

const n = (v: unknown) => (v == null || v === '' ? null : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;

export function montarRelatorioResultados(entrada: CasoResultado[]) {
  const casos = entrada.map((c) => ({ ...c, valor_causa: n(c.valor_causa), valor_obtido: n(c.valor_obtido) }));
  const encerrados = casos.filter((c) => c.resultado);
  const sucessos = encerrados.filter((c) => ehSucesso(c.resultado));

  const taxa = encerrados.length ? sucessos.length / encerrados.length : null;
  const baseObtido = sucessos.filter((c) => c.polo_cliente !== 'passivo' && c.valor_causa && c.valor_obtido != null);
  const somaCausa = baseObtido.reduce((s, c) => s + (c.valor_causa as number), 0);
  const somaObtido = baseObtido.reduce((s, c) => s + (c.valor_obtido as number), 0);
  const pctObtido = somaCausa ? somaObtido / somaCausa : null;

  const porResultado: Record<string, number> = {};
  for (const c of encerrados) porResultado[c.resultado as string] = (porResultado[c.resultado as string] || 0) + 1;

  const linhas = casos.map((c) => {
    const pct = c.valor_causa && c.valor_obtido != null && c.polo_cliente !== 'passivo' ? r1((c.valor_obtido / c.valor_causa) * 100) : null;
    const provisionavel = !c.resultado && !c.dativo && c.polo_cliente !== 'passivo' && c.valor_causa && taxa != null && pctObtido != null;
    const provisao = provisionavel ? r2((c.valor_causa as number) * (taxa as number) * (pctObtido as number) * (Number(c.fee_pct) / 100)) : null;
    return { ...c, pct_obtido: pct, provisao };
  });

  const emAndamento = linhas.filter((c) => !c.resultado);
  const soma = (k: 'honorarios_recebidos' | 'honorarios_a_receber' | 'repasse_parceiro') => r2(linhas.reduce((s, c) => s + (Number(c[k]) || 0), 0));

  return {
    casos: linhas,
    resumo: {
      com_resultado: encerrados.length,
      sucessos: sucessos.length,
      taxa_sucesso: taxa == null ? null : r1(taxa * 100),
      pct_obtido_medio: pctObtido == null ? null : r1(pctObtido * 100),
      por_resultado: porResultado,
      em_andamento: emAndamento.length,
      em_andamento_sem_valor: emAndamento.filter((c) => !c.valor_causa && !c.dativo && c.polo_cliente !== 'passivo').length,
      provisao_total: r2(emAndamento.reduce((s, c) => s + (c.provisao || 0), 0)),
      honorarios_recebidos: soma('honorarios_recebidos'),
      honorarios_a_receber: soma('honorarios_a_receber'),
      repasse_parceiro: soma('repasse_parceiro'),
    },
  };
}
