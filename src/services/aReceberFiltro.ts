/**
 * A Receber — filtro por mês/período e totais do que foi filtrado (regras puras).
 *
 * Data de referência de cada item (07/10/2026, pedido "filtro do mês para ter
 * um relatório efetivo"):
 *  - RECEBIDO → a data em que o dinheiro entrou (pago_em; sem ela, o vencimento);
 *  - A RECEBER → o vencimento.
 * Assim "outubro" mostra o que entrou em outubro e o que vence em outubro.
 * Os totais (programado, recebido, a receber, vencido) são sempre do conjunto
 * filtrado — antes eram de todos os tempos, qualquer que fosse o filtro.
 */

export interface ItemAReceber {
  fonte: string; cliente?: string | null; descricao?: string | null; valor: number;
  vencimento?: unknown; pago_em?: unknown; recebido: boolean; vencido: boolean;
  [k: string]: unknown;
}
export interface FiltroAReceber { status?: string; fonte?: string; busca?: string; de?: string; ate?: string }

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Data AAAA-MM-DD de um valor do banco (Date ou texto), ou null. */
export function dia(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).slice(0, 10);
  return ISO.test(s) ? s : null;
}

/** 'AAAA-MM' → primeiro e último dia do mês. */
export function periodoDoMes(mes: string): { de: string; ate: string } | null {
  const m = String(mes || '').match(/^(\d{4})-(\d{2})$/);
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  const ultimo = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
  return { de: `${m[1]}-${m[2]}-01`, ate: `${m[1]}-${m[2]}-${String(ultimo).padStart(2, '0')}` };
}

export const dataReferencia = (x: ItemAReceber) => (x.recebido ? dia(x.pago_em) || dia(x.vencimento) : dia(x.vencimento));

export function filtrarAReceber<T extends ItemAReceber>(rows: T[], f: FiltroAReceber, _hoje?: string): T[] {
  const busca = String(f.busca || '').trim().toLowerCase();
  const de = ISO.test(String(f.de || '')) ? String(f.de) : '';
  const ate = ISO.test(String(f.ate || '')) ? String(f.ate) : '';
  return rows.filter((x) => {
    if (f.status === 'aberto' && x.recebido) return false;
    if (f.status === 'recebido' && !x.recebido) return false;
    if (f.status === 'vencido' && !x.vencido) return false;
    if (f.fonte && x.fonte !== f.fonte) return false;
    if (busca && !`${x.cliente || ''} ${x.descricao || ''}`.toLowerCase().includes(busca)) return false;
    if (de || ate) {
      const d = dataReferencia(x);
      if (!d || (de && d < de) || (ate && d > ate)) return false;
    }
    return true;
  });
}

export function kpisAReceber(rows: ItemAReceber[]) {
  const soma = (xs: ItemAReceber[], campo: 'valor' | 'seu' | 'parceiro' = 'valor') =>
    Math.round(xs.reduce((s, r) => s + (Number(campo === 'valor' ? r.valor : (r as any)[campo] ?? (campo === 'seu' ? r.valor : 0)) || 0), 0) * 100) / 100;
  const abertos = rows.filter((r) => !r.recebido), recebidos = rows.filter((r) => r.recebido), vencidos = rows.filter((r) => r.vencido);
  return {
    programado: soma(rows),
    recebido: soma(recebidos),
    a_receber: soma(abertos),
    vencido: soma(vencidos),
    // o que é SEU (já descontada a parte da parceira) e o que vai para a parceira
    seu_programado: soma(rows, 'seu'),
    seu_recebido: soma(recebidos, 'seu'),
    seu_a_receber: soma(abertos, 'seu'),
    seu_vencido: soma(vencidos, 'seu'),
    parceiro_a_receber: soma(abertos, 'parceiro'),
    parceiro_recebido: soma(recebidos, 'parceiro'),
    itens: rows.length,
  };
}

export interface Parceria { nome: string; split: number; sucumbSplit: number; entrySplit: boolean }
/**
 * Quanto de um recebimento é da parceira e quanto é seu. Mesma regra do
 * repasse (POST /api/partners/cases/:id/resultado): êxito/honorário → split%
 * (Infinity Law: 50% dos 30% = 15%); sucumbência → sucumbSplit%; entrada da
 * parceria → só se entrySplit (Infinity: não, a entrada é do escritório).
 */
export function separarParceiro(r: { valor: number; descricao?: string | null }, p: Parceria | null): { parceiro: number; seu: number; parceiroNome: string | null } {
  const valor = Number(r.valor) || 0;
  if (!p) return { parceiro: 0, seu: valor, parceiroNome: null };
  const d = String(r.descricao || '');
  const pct = /^entrada/i.test(d) ? (p.entrySplit ? p.split : 0) : /sucumb/i.test(d) ? p.sucumbSplit : p.split;
  const parceiro = Math.round(valor * pct) / 100;
  return { parceiro, seu: Math.round((valor - parceiro) * 100) / 100, parceiroNome: p.nome };
}

/**
 * Marca o que está vencido: não recebido e com vencimento antes de hoje.
 * O vencimento vem do MySQL como objeto Date; String(Date) não é ISO e a
 * comparação antiga nunca dava "vencido" (07/10/2026: card Vencido R$ 0,00
 * com parcelas de setembro em aberto). Usa a data ISO.
 */
export function marcarVencidos<T extends ItemAReceber>(rows: T[], hoje: string): T[] {
  for (const r of rows) {
    const d = dia(r.vencimento);
    r.vencido = !r.recebido && !!d && d < hoje;
  }
  return rows;
}
