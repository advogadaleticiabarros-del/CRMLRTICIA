/**
 * Cálculos da petição inicial feitos em código (a IA só redige com eles).
 * - Repetição do indébito com a modulação do STJ (EAREsp 600.663/RS, 30/03/2021):
 *   cobrança até 03/2021 volta simples; de 04/2021 em diante, em dobro.
 * - Juros: parcela recalculada pela tabela Price com a taxa média de mercado.
 * - Valor da causa: soma do que foi calculado; o dano moral só entra se informado.
 * Aqui os valores são nominais; a correção monetária e os juros de mora entram
 * na planilha do Calculista (planilhaCalculos.ts), que atualiza o valor da causa.
 */

import type { PlanilhaAtualizada } from './planilhaCalculos';

export interface Desconto { competencia: string; valor: number; contrato?: string | null; fonte?: string | null }

export interface ContratoCalculo {
  numero?: string | null; tipo?: string | null;
  valor_liberado?: number | null; parcela?: number | null; n_parcelas?: number | null; parcelas_pagas?: number | null;
  taxa_mensal?: number | null; taxa_media_mercado?: number | null;
  /** "aaaa-mm": 1º e último mês de desconto no benefício (extrato do INSS). */
  inicio_desconto?: string | null; fim_desconto?: string | null;
}

export interface EntradaCalculo {
  contratos: ContratoCalculo[];
  descontos: Desconto[];
  danoMoral?: number | null;
  hoje?: Date;
}

const somarMeses = (c: string, n: number) => {
  const t = Number(c.slice(0, 4)) * 12 + Number(c.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

/**
 * Contrato com parcela e mês de início, mas sem os descontos mês a mês: monta
 * os meses (até o fim informado, o nº de parcelas ou o mês atual, o que vier antes).
 */
export function estimarDescontos(contratos: ContratoCalculo[], lidos: Desconto[], hoje: Date): { descontos: Desconto[]; estimados: string[] } {
  const comLidos = new Set(lidos.map((d) => String(d.contrato || '').trim()).filter(Boolean));
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const descontos: Desconto[] = []; const estimados: string[] = [];
  for (const c of contratos) {
    const num = String(c.numero || '').trim();
    if (!c.parcela || !c.inicio_desconto || !/^\d{4}-\d{2}$/.test(c.inicio_desconto) || (num && comLidos.has(num))) continue;
    const fins = [mesAtual];
    if (c.fim_desconto && /^\d{4}-\d{2}$/.test(c.fim_desconto)) fins.push(c.fim_desconto);
    if (c.n_parcelas) fins.push(somarMeses(c.inicio_desconto, c.n_parcelas - 1));
    const fim = fins.sort()[0];
    for (let m = c.inicio_desconto; m <= fim; m = somarMeses(m, 1)) descontos.push({ competencia: m, valor: c.parcela, contrato: num || c.tipo || 'sem número', fonte: 'estimado pelo contrato' });
    estimados.push(num || c.tipo || 'sem número');
  }
  return { descontos, estimados };
}

/** Última competência devolvida de forma simples (cobranças até 30/03/2021). */
export const MARCO_DOBRO = '2021-03';

export const r2 = (n: number) => (n < 0 ? -1 : 1) * Math.round(Number((Math.abs(n) * 100).toFixed(6))) / 100;

export function brl(n: number): string {
  const neg = n < 0;
  const [int, dec] = Math.abs(r2(n)).toFixed(2).split('.');
  return `${neg ? '-' : ''}R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
}

export const mesBr = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

/** Parcela fixa (tabela Price). i em fração ao mês (2% = 0.02). */
export function parcelaPrice(pv: number, i: number, n: number): number {
  if (!n) return 0;
  if (!i) return r2(pv / n);
  return r2((pv * i) / (1 - Math.pow(1 + i, -n)));
}

export interface IndebitoContrato {
  contrato: string; meses: number; periodo: string; descontado: number;
  simples: { meses: number; valor: number };
  dobro: { meses: number; pago: number; restituir: number };
  restituir: number;
}

export interface Indebito {
  porContrato: IndebitoContrato[];
  total: { descontado: number; restituirSimples: number; restituirDobro: number; restituir: number };
  repetidosIgnorados: number;
}

/**
 * Descontos válidos, um por contrato e mês: o mesmo desconto lido em mais de um
 * documento conta uma vez só. É a base do indébito e da planilha de cálculos.
 */
export function descontosUnicos(descontos: Desconto[]): { descontos: Desconto[]; repetidos: number } {
  const vistos = new Set<string>();
  const out: Desconto[] = [];
  let repetidos = 0;
  for (const d of descontos) {
    if (!/^\d{4}-\d{2}$/.test(d.competencia) || !(d.valor > 0)) continue;
    const contrato = String(d.contrato || 'sem número').trim() || 'sem número';
    const chave = `${contrato}|${d.competencia}`;
    if (vistos.has(chave)) { repetidos++; continue; }
    vistos.add(chave);
    out.push({ ...d, contrato });
  }
  return { descontos: out, repetidos };
}

export function calcularIndebito(descontos: Desconto[]): Indebito {
  const unicos = descontosUnicos(descontos);
  const grupos = new Map<string, Desconto[]>();
  for (const d of unicos.descontos) {
    const contrato = d.contrato as string;
    if (!grupos.has(contrato)) grupos.set(contrato, []);
    grupos.get(contrato)!.push(d);
  }
  const porContrato: IndebitoContrato[] = [];
  for (const [contrato, lista] of grupos) {
    lista.sort((a, b) => a.competencia.localeCompare(b.competencia));
    const simples = lista.filter((d) => d.competencia <= MARCO_DOBRO);
    const dobro = lista.filter((d) => d.competencia > MARCO_DOBRO);
    const soma = (l: Desconto[]) => r2(l.reduce((s, d) => s + d.valor, 0));
    const vSimples = soma(simples), vDobro = soma(dobro);
    porContrato.push({
      contrato, meses: lista.length,
      periodo: `${mesBr(lista[0].competencia)} a ${mesBr(lista[lista.length - 1].competencia)}`,
      descontado: r2(vSimples + vDobro),
      simples: { meses: simples.length, valor: vSimples },
      dobro: { meses: dobro.length, pago: vDobro, restituir: r2(vDobro * 2) },
      restituir: r2(vSimples + vDobro * 2),
    });
  }
  const tot = (f: (c: IndebitoContrato) => number) => r2(porContrato.reduce((s, c) => s + f(c), 0));
  return {
    porContrato,
    total: { descontado: tot((c) => c.descontado), restituirSimples: tot((c) => c.simples.valor), restituirDobro: tot((c) => c.dobro.restituir), restituir: tot((c) => c.restituir) },
    repetidosIgnorados: unicos.repetidos,
  };
}

export interface ComparacaoJuros {
  contrato?: string; taxaContratadaMensal: number; taxaMediaMensal: number; razao: number;
  parcelaContratada: number; parcelaRecalculada: number; diferencaPorParcela: number;
  parcelasPagas: number; pagoAMais: number; nParcelas: number;
}

export function compararJuros(e: {
  valorLiberado: number; nParcelas: number; taxaContratadaMensal: number; taxaMediaMensal: number;
  parcelaContratada?: number | null; parcelasPagas?: number | null; contrato?: string;
}): ComparacaoJuros {
  const parcelaContratada = e.parcelaContratada || parcelaPrice(e.valorLiberado, e.taxaContratadaMensal / 100, e.nParcelas);
  const parcelaRecalculada = parcelaPrice(e.valorLiberado, e.taxaMediaMensal / 100, e.nParcelas);
  const diferencaPorParcela = r2(Math.max(0, parcelaContratada - parcelaRecalculada));
  const parcelasPagas = Math.max(0, Math.min(e.parcelasPagas ?? 0, e.nParcelas));
  return {
    contrato: e.contrato, taxaContratadaMensal: e.taxaContratadaMensal, taxaMediaMensal: e.taxaMediaMensal,
    razao: r2(e.taxaContratadaMensal / e.taxaMediaMensal), parcelaContratada, parcelaRecalculada, diferencaPorParcela,
    parcelasPagas, pagoAMais: r2(diferencaPorParcela * parcelasPagas), nParcelas: e.nParcelas,
  };
}

export interface CalculoPeca {
  indebito: Indebito;
  juros: ComparacaoJuros[];
  /** restituicao: o total atualizado da planilha quando houver; sem ela, o nominal. */
  valorDaCausa: { restituicao: number; jurosPagosAMais: number; danoMoral: number | null; total: number };
  avisos: string[];
  /** Descontos do indébito, sem repetição (inclui os estimados pelo contrato). */
  descontos: Desconto[];
  /** Planilha com correção e juros (Calculista, planilhaCalculos.ts); null enquanto não atualizada. */
  atualizacao?: PlanilhaAtualizada | null;
}

export function calcularPeca(e: EntradaCalculo): CalculoPeca {
  const avisos: string[] = [];
  const est = estimarDescontos(e.contratos || [], e.descontos || [], e.hoje || new Date());
  for (const n of est.estimados) avisos.push(`Contrato ${n}: descontos mês a mês estimados pela parcela e pelo período do contrato — conferir com o extrato do benefício.`);
  const todos = [...(e.descontos || []), ...est.descontos];
  const indebito = calcularIndebito(todos);
  if (indebito.repetidosIgnorados) avisos.push(`${indebito.repetidosIgnorados} desconto(s) apareceram em mais de um documento e foram contados uma vez só.`);
  const juros: ComparacaoJuros[] = [];
  for (const c of e.contratos || []) {
    if (!c.taxa_mensal) continue;
    const nome = c.numero || c.tipo || 'sem número';
    if (!c.taxa_media_mercado) { avisos.push(`Contrato ${nome}: tem taxa de ${c.taxa_mensal}% a.m., mas falta a taxa média do Bacen da data do contrato para comparar.`); continue; }
    if (!c.valor_liberado || !c.n_parcelas) { avisos.push(`Contrato ${nome}: falta o valor liberado ou o número de parcelas para recalcular os juros.`); continue; }
    juros.push(compararJuros({ contrato: nome, valorLiberado: c.valor_liberado, nParcelas: c.n_parcelas, taxaContratadaMensal: c.taxa_mensal, taxaMediaMensal: c.taxa_media_mercado, parcelaContratada: c.parcela, parcelasPagas: c.parcelas_pagas }));
    if (!c.parcelas_pagas) avisos.push(`Contrato ${nome}: sem o número de parcelas já pagas; o valor pago a mais ficou zerado.`);
  }
  const jurosPagosAMais = r2(juros.reduce((s, j) => s + j.pagoAMais, 0));
  const danoMoral = e.danoMoral ?? null;
  if (danoMoral == null) avisos.push('Dano moral sem valor definido: a peça deixa [valor do dano moral] e o valor da causa precisa somá-lo.');
  return {
    indebito, juros,
    valorDaCausa: { restituicao: indebito.total.restituir, jurosPagosAMais, danoMoral, total: r2(indebito.total.restituir + jurosPagosAMais + (danoMoral || 0)) },
    avisos,
    descontos: descontosUnicos(todos).descontos,
  };
}
