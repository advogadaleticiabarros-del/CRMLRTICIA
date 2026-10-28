import { brl, mesBr, r2, MARCO_DOBRO, type CalculoPeca, type Desconto } from './pecaCalculos';
import { somarMeses, mesDe, type IndicesMensais } from './indicesEconomicos';
import { gerarXlsx, type Celula } from './xlsxSimples';

/**
 * Calculista — planilha de cálculos da peça: cada desconto lido nos extratos,
 * devolvido simples ou em dobro, com correção monetária e juros de mora desde o
 * desconto até a data-base (último mês com índices publicados). Sai como tabela
 * no CRM (planilhaMarkdown) e como .xlsx com fórmulas para anexar (planilhaXlsx).
 * Os índices vêm do Bacen (indicesEconomicos.ts); testes em tests/planilhaCalculos.test.mjs.
 */

/** Último mês com as regras antigas: a Lei 14.905/2024 vale desde 30/08/2024. */
export const MARCO_LEI_14905 = '2024-08';

export const CRITERIOS = [
  'Devolução: descontos até 03/2021 de forma simples; de 04/2021 em diante, em dobro (art. 42, parágrafo único, do CDC; STJ, EAREsp 600.663/RS).',
  'Correção monetária desde cada desconto (Súmula 43 do STJ), pelos índices do mês seguinte ao desconto até a data-base: INPC até 08/2024 e IPCA a partir de 09/2024 (art. 389, parágrafo único, do Código Civil, na redação da Lei 14.905/2024). Índice negativo não reduz o valor original.',
  'Juros de mora simples desde cada desconto (Súmula 54 do STJ; art. 398 do Código Civil), sobre o valor corrigido: 1% ao mês até 08/2024 (art. 406 do Código Civil, redação anterior, c/c art. 161, § 1º, do CTN) e, a partir de 09/2024, a taxa legal: Selic menos IPCA do mês, nunca negativa (art. 406, §§ 1º a 3º, do Código Civil).',
  'Fonte dos índices: Banco Central do Brasil, SGS — INPC (série 188), IPCA (série 433) e Selic acumulada no mês (série 4390).',
];

export interface LinhaPlanilha {
  competencia: string; contrato: string; descontado: number; regra: 'simples' | 'dobro';
  restituir: number; fator: number; corrigido: number; jurosPct: number; juros: number; total: number;
}
export interface MesIndice {
  competencia: string; indice: 'INPC' | 'IPCA'; correcao: number | null;
  regraJuros: '1% a.m.' | 'taxa legal'; selic: number | null; juros: number | null;
}
export interface TotaisPlanilha { descontado: number; restituir: number; corrigido: number; juros: number; total: number }
export interface PlanilhaAtualizada {
  /** Último mês com índices ("aaaa-mm"); null quando não havia índices (planilha nominal). */
  dataBase: string | null;
  linhas: LinhaPlanilha[];
  porContrato: Array<TotaisPlanilha & { contrato: string; meses: number; periodo: string }>;
  total: TotaisPlanilha;
  meses: MesIndice[];
  criterios: string[];
  avisos: string[];
}

const r4 = (n: number) => Number(n.toFixed(4));
const ultimo = (o: Record<string, number>) => Object.keys(o).sort().pop() || null;

function taxasDoMes(m: string, ind: IndicesMensais): MesIndice {
  if (m <= MARCO_LEI_14905) return { competencia: m, indice: 'INPC', correcao: ind.inpc[m] ?? null, regraJuros: '1% a.m.', selic: null, juros: 1 };
  const ipca = ind.ipca[m] ?? null, selic = ind.selic[m] ?? null;
  return { competencia: m, indice: 'IPCA', correcao: ipca, regraJuros: 'taxa legal', selic, juros: ipca == null || selic == null ? null : r4(Math.max(0, selic - ipca)) };
}

function somar(l: Array<Pick<LinhaPlanilha, 'descontado' | 'restituir' | 'corrigido' | 'juros' | 'total'>>): TotaisPlanilha {
  const s = (f: (x: LinhaPlanilha) => number) => r2(l.reduce((a, x) => a + f(x as LinhaPlanilha), 0));
  return { descontado: s((x) => x.descontado), restituir: s((x) => x.restituir), corrigido: s((x) => x.corrigido), juros: s((x) => x.juros), total: s((x) => x.total) };
}

/** Descontos já sem repetição (CalculoPeca.descontos). */
export function atualizarIndebito(descontos: Desconto[], indices: IndicesMensais | null, hoje: Date): PlanilhaAtualizada {
  const avisos: string[] = [];
  const validos = descontos.filter((d) => /^\d{4}-\d{2}$/.test(d.competencia) && d.valor > 0)
    .map((d) => ({ competencia: d.competencia, contrato: String(d.contrato || 'sem número'), valor: d.valor }))
    .sort((a, b) => a.contrato.localeCompare(b.contrato, 'pt-BR', { numeric: true }) || a.competencia.localeCompare(b.competencia));

  let dataBase: string | null = null;
  if (indices && ultimo(indices.ipca) && ultimo(indices.selic) && ultimo(indices.inpc)) {
    dataBase = [somarMeses(mesDe(hoje), -1), ultimo(indices.ipca)!, ultimo(indices.selic)!].sort()[0];
  } else {
    avisos.push('Índices do Bacen indisponíveis: planilha sem correção monetária e sem juros de mora (valores nominais). Gerar de novo mais tarde.');
  }

  // Tabela de índices do 1º mês depois do desconto mais antigo até a data-base.
  const meses: MesIndice[] = [];
  if (dataBase && indices && validos.length) {
    const ini = somarMeses(validos.map((d) => d.competencia).sort()[0], 1);
    for (let m = ini; m <= dataBase; m = somarMeses(m, 1)) meses.push(taxasDoMes(m, indices));
    const faltam = meses.filter((m) => m.correcao == null || m.juros == null).map((m) => mesBr(m.competencia));
    if (faltam.length) avisos.push(`Índice não publicado pelo Bacen em ${faltam.join(', ')}: contado como zero nesses meses.`);
  }
  const pos = new Map(meses.map((m, i) => [m.competencia, i]));

  const linhas: LinhaPlanilha[] = validos.map((d) => {
    const regra = d.competencia <= MARCO_DOBRO ? 'simples' : 'dobro';
    const restituir = r2(regra === 'dobro' ? d.valor * 2 : d.valor);
    let fator = 1, jurosPct = 0;
    const i0 = pos.get(somarMeses(d.competencia, 1));
    if (i0 != null) {
      for (const m of meses.slice(i0)) { fator *= 1 + (m.correcao ?? 0) / 100; jurosPct += m.juros ?? 0; }
    }
    fator = Math.max(1, Number(fator.toFixed(6)));
    jurosPct = r4(jurosPct);
    const corrigido = r2(restituir * fator);
    const juros = r2((corrigido * jurosPct) / 100);
    return { competencia: d.competencia, contrato: d.contrato, descontado: d.valor, regra, restituir, fator, corrigido, jurosPct, juros, total: r2(corrigido + juros) };
  });

  const contratos = [...new Set(linhas.map((l) => l.contrato))];
  const porContrato = contratos.map((contrato) => {
    const ls = linhas.filter((l) => l.contrato === contrato);
    return { contrato, meses: ls.length, periodo: `${mesBr(ls[0].competencia)} a ${mesBr(ls[ls.length - 1].competencia)}`, ...somar(ls) };
  });
  return { dataBase, linhas, porContrato, total: somar(linhas), meses, criterios: CRITERIOS, avisos };
}

/** O cálculo da peça com a planilha; o valor da causa passa a usar a restituição atualizada. */
export function atualizarCalculo(c: CalculoPeca, indices: IndicesMensais | null, hoje: Date): CalculoPeca {
  if (!c.descontos?.length) return { ...c, atualizacao: null };
  const p = atualizarIndebito(c.descontos, indices, hoje);
  const v = c.valorDaCausa;
  return {
    ...c, atualizacao: p, avisos: [...c.avisos, ...p.avisos],
    valorDaCausa: { ...v, restituicao: p.total.total, total: r2(p.total.total + v.jurosPagosAMais + (v.danoMoral || 0)) },
  };
}

// ── saídas ──────────────────────────────────────────────────────────────────

export interface CabecalhoPlanilha { cliente: string; reus?: string[]; casos?: Array<{ id: number; titulo: string | null }>; geradaEm?: Date }

const num = (n: number, casas: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const regraTxt = (r: LinhaPlanilha['regra']) => (r === 'dobro' ? 'em dobro' : 'simples');
const dataBaseTxt = (p: PlanilhaAtualizada) => (p.dataBase ? mesBr(p.dataBase) : 'sem atualização (índices indisponíveis)');

/** Tabela para ler no CRM (Mesa do caso → Cálculos) e copiar para a peça. */
export function planilhaMarkdown(c: CalculoPeca, cab: CabecalhoPlanilha): string {
  const p = c.atualizacao;
  const l: string[] = [`# Planilha de cálculos — ${cab.cliente}`, ''];
  if (!p) return [...l, 'Sem descontos lidos nos extratos: não há o que calcular.'].join('\n');
  l.push(`Repetição do indébito · atualizada até **${dataBaseTxt(p)}** · gerada em ${(cab.geradaEm || new Date()).toLocaleDateString('pt-BR')}`);
  if (cab.reus?.length) l.push('', `Réu: ${cab.reus.join('; ')}`);
  if (cab.casos?.length) l.push('', `Casos: ${cab.casos.map((x) => `#${x.id} ${x.titulo || ''}`.trim()).join(' · ')}`);

  l.push('', '## Resumo por contrato', '', '| Contrato | Descontos | Período | Descontado | A restituir | Corrigido | Juros de mora | Total atualizado |', '|---|---|---|---|---|---|---|---|');
  for (const x of p.porContrato) l.push(`| ${x.contrato} | ${x.meses} | ${x.periodo} | ${brl(x.descontado)} | ${brl(x.restituir)} | ${brl(x.corrigido)} | ${brl(x.juros)} | ${brl(x.total)} |`);
  const t = p.total;
  l.push(`| **Total** | ${p.linhas.length} | | **${brl(t.descontado)}** | **${brl(t.restituir)}** | **${brl(t.corrigido)}** | **${brl(t.juros)}** | **${brl(t.total)}** |`);

  const v = c.valorDaCausa;
  l.push('', '## Valor da causa', '', `- Restituição atualizada: ${brl(t.total)}`);
  if (v.jurosPagosAMais) l.push(`- Juros pagos a mais (revisão da taxa, valor nominal): ${brl(v.jurosPagosAMais)}`);
  l.push(`- Dano moral: ${v.danoMoral != null ? brl(v.danoMoral) : '[a definir]'}`);
  l.push(`- **Valor da causa: ${brl(v.total)}${v.danoMoral == null ? ' + [dano moral]' : ''}**`);

  l.push('', '## Mês a mês', '', '| Competência | Contrato | Descontado | Devolução | A restituir | Fator de correção | Corrigido | Juros (%) | Juros | Total |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const x of p.linhas) l.push(`| ${mesBr(x.competencia)} | ${x.contrato} | ${brl(x.descontado)} | ${regraTxt(x.regra)} | ${brl(x.restituir)} | ${num(x.fator, 6)} | ${brl(x.corrigido)} | ${num(x.jurosPct, 4)}% | ${brl(x.juros)} | ${brl(x.total)} |`);

  l.push('', '## Critérios', '', ...p.criterios.map((x) => `- ${x}`));
  if (p.avisos.length) l.push('', '## A conferir', '', ...p.avisos.map((x) => `- ${x}`));
  return l.join('\n');
}

/** Arquivo .xlsx para anexar: aba "Cálculo" (com fórmulas) e aba "Índices". */
export async function planilhaXlsx(c: CalculoPeca, cab: CabecalhoPlanilha): Promise<Buffer> {
  const p = c.atualizacao;
  const L: Celula[][] = [
    [{ v: 'PLANILHA DE CÁLCULOS — REPETIÇÃO DO INDÉBITO', s: 'titulo' }],
    [`Autor(a): ${cab.cliente}`],
    [cab.reus?.length ? `Réu: ${cab.reus.join('; ')}` : null],
    [`Valores atualizados até ${p ? dataBaseTxt(p) : '—'} · gerada em ${(cab.geradaEm || new Date()).toLocaleDateString('pt-BR')}`],
    [],
    ['Competência', 'Contrato', 'Valor descontado', 'Devolução', 'Valor a restituir', 'Fator de correção', 'Valor corrigido', 'Juros de mora (%)', 'Juros de mora (R$)', 'Total atualizado']
      .map((v) => ({ v, s: 'cabecalho' as const })),
  ];
  const primeira = L.length + 1;
  for (const x of p?.linhas || []) {
    const r = L.length + 1;
    L.push([
      mesBr(x.competencia), x.contrato, { v: x.descontado, s: 'moeda' }, regraTxt(x.regra),
      { f: x.regra === 'dobro' ? `C${r}*2` : `C${r}`, v: x.restituir, s: 'moeda' },
      { v: x.fator, s: 'fator' },
      { f: `ROUND(E${r}*F${r},2)`, v: x.corrigido, s: 'moeda' },
      { v: x.jurosPct, s: 'percentual' },
      { f: `ROUND(G${r}*H${r}/100,2)`, v: x.juros, s: 'moeda' },
      { f: `G${r}+I${r}`, v: x.total, s: 'moeda' },
    ]);
  }
  const ultima = L.length;
  const linhaTotal = L.length + 1;
  const soma = (col: string, v: number) => ({ f: `SUM(${col}${primeira}:${col}${ultima})`, v, s: 'moedaNegrito' as const });
  const t = p?.total || { descontado: 0, restituir: 0, corrigido: 0, juros: 0, total: 0 };
  L.push([{ v: 'TOTAL', s: 'negrito' }, null, soma('C', t.descontado), null, soma('E', t.restituir), null, soma('G', t.corrigido), null, soma('I', t.juros), soma('J', t.total)]);

  const v = c.valorDaCausa;
  L.push([], [{ v: 'VALOR DA CAUSA', s: 'negrito' }]);
  const ini = L.length + 1;
  L.push(['Restituição atualizada', null, { f: `J${linhaTotal}`, v: t.total, s: 'moeda' }]);
  if (v.jurosPagosAMais) L.push(['Juros pagos a mais (revisão da taxa, valor nominal)', null, { v: v.jurosPagosAMais, s: 'moeda' }]);
  L.push(['Dano moral', null, v.danoMoral != null ? { v: v.danoMoral, s: 'moeda' } : '[a definir]']);
  L.push([{ v: `Total${v.danoMoral == null ? ' (somar o dano moral)' : ''}`, s: 'negrito' }, null, { f: `SUM(C${ini}:C${L.length})`, v: v.total, s: 'moedaNegrito' }]);

  L.push([], [{ v: 'CRITÉRIOS', s: 'negrito' }], ...(p?.criterios || CRITERIOS).map((x) => [x] as Celula[]));
  if (p?.avisos.length) L.push([], [{ v: 'A CONFERIR', s: 'negrito' }], ...p.avisos.map((x) => [x] as Celula[]));

  const I: Celula[][] = [
    [{ v: 'ÍNDICES USADOS (Banco Central do Brasil — SGS)', s: 'titulo' }],
    [],
    ['Mês', 'Índice de correção', 'Correção do mês (%)', 'Selic do mês (%)', 'Regra dos juros', 'Juros do mês (%)'].map((x) => ({ v: x, s: 'cabecalho' as const })),
    ...(p?.meses || []).map((m): Celula[] => [
      mesBr(m.competencia), m.indice, m.correcao != null ? { v: m.correcao, s: 'percentual' } : 'não publicado',
      m.selic != null ? { v: m.selic, s: 'percentual' } : (m.regraJuros === 'taxa legal' ? 'não publicado' : '—'),
      m.regraJuros, m.juros != null ? { v: m.juros, s: 'percentual' } : 'não publicado',
    ]),
  ];
  return gerarXlsx([
    { nome: 'Cálculo', linhas: L, larguras: [13, 24, 17, 11, 17, 15, 17, 15, 17, 18] },
    { nome: 'Índices', linhas: I, larguras: [10, 18, 18, 16, 16, 16] },
  ]);
}
