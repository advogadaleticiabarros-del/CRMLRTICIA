/**
 * Índices econômicos mensais do Bacen (SGS) para a planilha de cálculos:
 * INPC, IPCA, Selic acumulada no mês e a Taxa Legal (art. 406 do Código Civil), em % ao
 * mês, por competência "aaaa-mm". A Taxa Legal é a oficial publicada pelo Bacen (SGS 29543,
 * Resolução CMN 5.171/2024: razão entre a Selic e o IPCA-15 do mês anterior, piso zero),
 * desde 08/2024.
 * Guarda em cache (indices_economicos) e só busca o que falta; o mês corrente
 * nunca entra (a Selic dele é parcial). Banco e rede entram por `DepsIndices`
 * (indicesEconomicosMysql.ts); testes em tests/planilhaCalculos.test.mjs.
 */

export type Serie = 'inpc' | 'ipca' | 'selic' | 'legal';
export const SERIES_BACEN: Record<Serie, number> = { inpc: 188, ipca: 433, selic: 4390, legal: 29543 };
/** A série começa depois do "desde" geral: a Taxa Legal só existe a partir de 08/2024. */
const INICIO_SERIE: Partial<Record<Serie, string>> = { legal: '2024-08' };

/** `legal` é opcional para quem monta índices à mão (testes, índices antigos sem a série). */
export type IndicesMensais = Record<'inpc' | 'ipca' | 'selic', Record<string, number>> & { legal?: Record<string, number> };
export interface LinhaIndice { serie: Serie; competencia: string; valor: number }

export interface DepsIndices {
  cache(): Promise<LinhaIndice[]>;
  guardar(linhas: LinhaIndice[]): Promise<void>;
  /** JSON cru da API SGS do Bacen; datas "dd/MM/aaaa". */
  bacen(codigo: number, de: string, ate: string): Promise<unknown>;
  hoje(): Date;
}

/** [{ data: "01/06/2024", valor: "0.21" }] → [{ competencia: "2024-06", valor: 0.21 }]. */
export function lerSerieBacen(json: unknown): Array<{ competencia: string; valor: number }> {
  if (!Array.isArray(json)) return [];
  const out: Array<{ competencia: string; valor: number }> = [];
  for (const r of json) {
    const m = String(r?.data ?? '').match(/^\d{2}\/(\d{2})\/(\d{4})$/);
    const v = r?.valor === '' || r?.valor == null ? NaN : Number(r.valor);
    if (m && Number.isFinite(v)) out.push({ competencia: `${m[2]}-${m[1]}`, valor: v });
  }
  return out;
}

export const somarMeses = (c: string, n: number) => {
  const t = Number(c.slice(0, 4)) * 12 + Number(c.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
export const mesDe = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const dataBr = (c: string, ultimoDia = false) => {
  const dia = ultimoDia ? new Date(Number(c.slice(0, 4)), Number(c.slice(5, 7)), 0).getDate() : 1;
  return `${String(dia).padStart(2, '0')}/${c.slice(5, 7)}/${c.slice(0, 4)}`;
};

/** Cache + o que faltar no Bacen (em janelas de até 10 anos, limite da API). */
export async function carregarIndices(deps: DepsIndices, desde = '2005-01'): Promise<{ indices: IndicesMensais; avisos: string[] }> {
  const indices: Record<Serie, Record<string, number>> = { inpc: {}, ipca: {}, selic: {}, legal: {} };
  const avisos: string[] = [];
  for (const l of await deps.cache().catch(() => [] as LinhaIndice[])) if (indices[l.serie]) indices[l.serie][l.competencia] = Number(l.valor);
  const ultimoFechado = somarMeses(mesDe(deps.hoje()), -1);
  const novos: LinhaIndice[] = [];
  for (const serie of Object.keys(SERIES_BACEN) as Serie[]) {
    const tem = Object.keys(indices[serie]).sort();
    const inicio = INICIO_SERIE[serie] && INICIO_SERIE[serie]! > desde ? INICIO_SERIE[serie]! : desde;
    let ini = tem.length ? somarMeses(tem[tem.length - 1], 1) : inicio;
    if (ini > ultimoFechado) continue;
    while (ini <= ultimoFechado) {
      const fimJanela = somarMeses(ini, 12 * 10 - 13); // < 10 anos-calendário por chamada
      const fim = fimJanela < ultimoFechado ? fimJanela : ultimoFechado;
      try {
        for (const r of lerSerieBacen(await deps.bacen(SERIES_BACEN[serie], dataBr(ini), dataBr(fim, true)))) {
          if (r.competencia > ultimoFechado || r.competencia < ini) continue;
          indices[serie][r.competencia] = r.valor;
          novos.push({ serie, competencia: r.competencia, valor: r.valor });
        }
      } catch (e: any) {
        avisos.push(`Bacen fora do ar ao buscar ${serie.toUpperCase()} (${e?.message || 'erro'}): usados os índices já guardados.`);
        break;
      }
      ini = somarMeses(fim, 1);
    }
  }
  if (novos.length) await deps.guardar(novos).catch(() => {});
  return { indices, avisos };
}
