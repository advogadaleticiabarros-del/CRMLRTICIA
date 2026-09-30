/**
 * Vigia da carteira — regras puras. A varredura diária (`carteiraVigiaJob.ts`)
 * usa estas funções para avisar no sino, sem ninguém perguntar:
 *  - processo monitorado parado (sem movimentação) há 30/60 dias;
 *  - data-limite prescricional se aproximando (90/60/30/15/7 dias, e vencida).
 * A data prescricional é SEMPRE informada/confirmada pela advogada; a
 * sugestão por área é só ponto de partida — nunca decisão automática.
 */

const DIA = 86_400_000;
const dias = (de: string, ate: string) => Math.round((Date.parse(ate.slice(0, 10)) - Date.parse(de.slice(0, 10))) / DIA);

/** Maior marco de inatividade atingido (30 ou 60), ou null. Sem data = sem alerta. */
export function marcoParado(ultimaMov: string | null, hoje: string): 30 | 60 | null {
  if (!ultimaMov) return null;
  const d = dias(ultimaMov, hoje);
  if (d >= 60) return 60;
  if (d >= 30) return 30;
  return null;
}

const MARCOS_PRESCRICAO = [7, 15, 30, 60, 90] as const;

/** Menor marco já alcançado antes da data prescricional; 0 = já passou; null = longe. */
export function marcoPrescricao(dataLimite: string, hoje: string): number | null {
  const faltam = dias(hoje, dataLimite);
  if (faltam < 0) return 0;
  for (const m of MARCOS_PRESCRICAO) if (faltam <= m) return m;
  return null;
}

const REGRAS: Record<string, { anos: number; base: string }> = {
  trabalhista: { anos: 2, base: 'CF art. 7º, XXIX — 2 anos após o fim do contrato (confira também os 5 anos retroativos)' },
  gestante: { anos: 2, base: 'CF art. 7º, XXIX — 2 anos após o fim do contrato' },
  consumidor: { anos: 5, base: 'CDC art. 27 — 5 anos do conhecimento do dano e da autoria (fato do produto/serviço)' },
  civel: { anos: 3, base: 'CC art. 206, §3º, V — 3 anos para reparação civil' },
  familia: { anos: 2, base: 'CC art. 206, §2º — 2 anos para prestações alimentares vencidas' },
};

/** Sugestão (nunca decisão) a partir da área e da data do fato gerador. */
export function sugerirPrescricao(area: string | null, fatoGerador: string | null): { data: string; base: string } | null {
  const r = REGRAS[String(area || '').toLowerCase()];
  if (!r || !fatoGerador) return null;
  const d = new Date(fatoGerador.slice(0, 10) + 'T12:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + r.anos);
  return { data: d.toISOString().slice(0, 10), base: r.base };
}

const br = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

export function textoPrescricao(c: { clientName: string | null; title: string; data: string }, marco: number): string {
  const quem = c.clientName ? `${c.clientName} — ${c.title}` : c.title;
  if (marco === 0) return `A data-limite prescricional informada (${br(c.data)}) já passou: ${quem}. Confira a situação do caso.`;
  return `Prescrição em até ${marco} dias (${br(c.data)}): ${quem}. Confira se a ação já foi proposta.`;
}

export function textoParado(p: { processNumber: string; clientName: string | null }, marco: number): string {
  return `Processo ${p.processNumber}${p.clientName ? ` (${p.clientName})` : ''} sem movimentação há mais de ${marco} dias. Vale consultar o andamento ou peticionar.`;
}
