/**
 * Métricas da IA (tela "Métricas da IA" do escritório virtual): séries por dia
 * e quanto do uso saiu sem custo. Regras puras — tests/painelIa.test.mjs.
 */

/** Provedores cobrados por chamada. Groq, Gemini (cota grátis) e Laya (local) não custam. */
export const PROVEDORES_PAGOS = ['openai', 'openai_smart'];

const isoDia = (d: Date | string) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);

/** Série de `dias` dias terminando em `hojeISO`, com zero nos dias sem registro. */
export function serieDiaria(rows: Array<{ dia: Date | string; chamadas: number }>, dias: number, hojeISO: string): Array<{ dia: string; chamadas: number }> {
  const mapa = new Map<string, number>();
  for (const r of rows) mapa.set(isoDia(r.dia), (mapa.get(isoDia(r.dia)) || 0) + Number(r.chamadas || 0));
  const fim = new Date(hojeISO + 'T12:00:00Z');
  const out: Array<{ dia: string; chamadas: number }> = [];
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(fim.getTime() - i * 86400000).toISOString().slice(0, 10);
    out.push({ dia: d, chamadas: mapa.get(d) || 0 });
  }
  return out;
}

export function resumoUsoIa(rows: Array<{ provedor: string; chamadas: number }>) {
  const porProvedor: Record<string, number> = {};
  for (const r of rows) porProvedor[r.provedor] = (porProvedor[r.provedor] || 0) + Number(r.chamadas || 0);
  const total = Object.values(porProvedor).reduce((a, b) => a + b, 0);
  const pagas = PROVEDORES_PAGOS.reduce((a, p) => a + (porProvedor[p] || 0), 0);
  const semCusto = total - pagas;
  return { total, pagas, semCusto, percentualSemCusto: total ? Math.round((semCusto / total) * 100) : 0, porProvedor };
}
