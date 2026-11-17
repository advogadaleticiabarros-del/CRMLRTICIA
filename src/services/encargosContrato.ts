import { db } from '../config/database';

/**
 * Encargos de atraso conforme o CONTRATO de cada cliente.
 *
 * Pedido de 17/11/2026: "sempre calcule de acordo com cada contrato do
 * cliente". A multa, os juros e a correção saem da cláusula de inadimplemento
 * do contrato daquele cliente (tabela `contracts`). Contrato sem essa cláusula
 * (ou cliente sem contrato) = nenhum encargo, e quem usa avisa a equipe. Nunca
 * se usa a multa de falta à audiência (20% da causa) nem um padrão inventado.
 *
 * Método (pro rata die, igual para todos):
 *   1. correção pelo IPCA, quando o contrato prevê: cada dia de atraso aplica
 *      (1 + IPCA do mês)^(1/dias do mês). Mês ainda não divulgado usa o último
 *      IPCA publicado (marcado como estimado). Deflação não reduz o valor.
 *   2. multa sobre o valor corrigido;
 *   3. juros simples ao mês sobre o valor corrigido × dias/30.
 */

export interface RegraEncargos { multaPct: number; jurosMesPct: number; ipca: boolean }
export interface Encargos {
  diasAtraso: number; correcao: number; multa: number; juros: number; total: number;
  ipcaEstimado: boolean; ipcaIndisponivel: boolean;
}
/** IPCA mensal em %, chave AAAA-MM. */
export type SerieIpca = Map<string, number>;

const num = (s: string) => Number(String(s).replace(',', '.'));
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const dia = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

/** Texto puro do contrato (HTML e markdown fora, espaços normalizados). */
function textoPuro(t: string): string {
  return String(t || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\*\*/g, '').replace(/\s+/g, ' ');
}

/**
 * Lê a cláusula de inadimplemento. Exige "multa moratória" ou juros "ao mês":
 * a multa de falta à audiência ("multa não compensatória ... valor da causa")
 * e a multa em reais nunca entram.
 */
export function lerClausulaAtraso(conteudo: string): RegraEncargos | null {
  const t = textoPuro(conteudo);
  const multa = t.match(/multa\s+morat[óo]ria\s+de\s+(\d+(?:[.,]\d+)?)\s*%/i);
  const juros = t.match(/juros(?:\s+de\s+mora)?(?:\s+de)?\s+(\d+(?:[.,]\d+)?)\s*%[^.;%]{0,80}?ao\s+m[êe]s/i);
  if (!multa && !juros) return null;
  return {
    multaPct: multa ? num(multa[1]) : 0,
    jurosMesPct: juros ? num(juros[1]) : 0,
    ipca: /corre[çc][ãa]o\s+monet[áa]ria\s+pelo\s+IPCA/i.test(t),
  };
}

export function calcularEncargos(valor: number, vencimento: string, hoje: string,
  regra: RegraEncargos | null, ipca: SerieIpca | null): Encargos {
  const diasAtraso = Math.max(0, Math.round((dia(hoje) - dia(vencimento)) / 86400000));
  const base: Encargos = { diasAtraso, correcao: 0, multa: 0, juros: 0, total: r2(valor), ipcaEstimado: false, ipcaIndisponivel: false };
  if (!diasAtraso || !regra) return base;

  let fator = 1;
  if (regra.ipca) {
    if (!ipca || !ipca.size) base.ipcaIndisponivel = true;
    else {
      const meses = [...ipca.keys()].sort();
      const ultimo = meses[meses.length - 1];
      for (let k = 1; k <= diasAtraso; k++) {
        const d = new Date(dia(vencimento) + k * 86400000);
        const chave = d.toISOString().slice(0, 7);
        let pct = ipca.get(chave);
        if (pct === undefined) { pct = ipca.get(ultimo)!; base.ipcaEstimado = true; }
        const diasNoMes = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
        fator *= Math.pow(1 + pct / 100, 1 / diasNoMes);
      }
      fator = Math.max(1, fator);
    }
  }
  const corrigido = valor * fator;
  base.correcao = r2(corrigido - valor);
  base.multa = r2(corrigido * regra.multaPct / 100);
  base.juros = r2(corrigido * regra.jurosMesPct / 100 * diasAtraso / 30);
  base.total = r2(valor + base.correcao + base.multa + base.juros);
  return base;
}

export interface ContratoResumo { id: number; status: string; value: any; created_at: any }

/** Assinado antes de enviado para assinatura; com valor igual ao da receita; depois o mais recente. */
export function escolherContrato<T extends ContratoResumo>(contratos: T[], valorReceita?: number | null): T | null {
  const peso = (s: string) => (s === 'assinado' ? 2 : s === 'enviado_assinatura' ? 1 : 0);
  const validos = contratos.filter((c) => peso(c.status) > 0);
  if (!validos.length) return null;
  const alvo = Number(valorReceita) || 0;
  return [...validos].sort((a, b) =>
    peso(b.status) - peso(a.status)
    || (alvo ? Number(Math.abs(Number(b.value) - alvo) < 0.01) - Number(Math.abs(Number(a.value) - alvo) < 0.01) : 0)
    || String(b.created_at instanceof Date ? b.created_at.toISOString() : b.created_at)
      .localeCompare(String(a.created_at instanceof Date ? a.created_at.toISOString() : a.created_at))
    || b.id - a.id)[0];
}

/** Regra do contrato do cliente. null = sem contrato ou sem cláusula de atraso. */
export async function regraDoCliente(clientId: number | null | undefined, valorReceita?: number | null):
  Promise<{ regra: RegraEncargos | null; contratoId: number | null }> {
  if (!clientId) return { regra: null, contratoId: null };
  const [cs] = await db.query('SELECT id, status, value, created_at, content FROM contracts WHERE client_id = ?', [clientId]) as any;
  const c = escolherContrato(cs as any[], valorReceita) as any;
  if (!c) return { regra: null, contratoId: null };
  return { regra: lerClausulaAtraso(c.content), contratoId: c.id };
}

// ── IPCA: mesma fonte da planilha do Calculista (indices_economicos + Bacen) ──
// Uma fonte só para o índice: `indicesDoBacen` guarda no banco e busca no Bacen
// (série 433) só o que faltar. Aqui fica em memória por 12h.
let cacheIpca: { em: number; serie: SerieIpca } | null = null;
export async function serieIpca(
  carregar: () => Promise<{ indices: { ipca: Record<string, number> } }> = async () =>
    (await import('./indicesEconomicosMysql')).indicesDoBacen(),
): Promise<SerieIpca | null> {
  if (cacheIpca && Date.now() - cacheIpca.em < 12 * 3600 * 1000) return cacheIpca.serie;
  try {
    const serie: SerieIpca = new Map(Object.entries((await carregar()).indices.ipca || {}).map(([k, v]) => [k, Number(v)]));
    if (!serie.size) return cacheIpca?.serie ?? null;
    cacheIpca = { em: Date.now(), serie };
    return serie;
  } catch {
    return cacheIpca?.serie ?? null;
  }
}
