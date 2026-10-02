/**
 * Monitoramento do link público da proposta — regras puras.
 * Cada abertura do link é uma "visita"; a página manda um sinal a cada ~15s
 * enquanto está visível. Sem IP nem localização (LGPD): só tempo, até onde
 * rolou a página e o tipo de aparelho.
 */

const MAX_SEG_POR_SINAL = 30;

/** Segundos creditados por sinal — limitado, para ninguém inflar o tempo. */
export function segundosDoSinal(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_SEG_POR_SINAL);
}

export function scrollValido(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 100);
}

export function dispositivo(ua: string | null | undefined): 'celular' | 'tablet' | 'computador' {
  const u = String(ua || '');
  if (/iPad|Tablet/i.test(u)) return 'tablet';
  if (/iPhone|Android.*Mobile|Mobile/i.test(u)) return 'celular';
  if (/Android/i.test(u)) return 'tablet';
  return 'computador';
}

export interface Visita { iniciada_em: string | Date; segundos: number; scroll_max: number; dispositivo: string }

const iso = (d: string | Date) => (d instanceof Date ? d.toISOString() : String(d));

export function resumoVisitas(vs: Visita[]) {
  const ord = [...vs].sort((a, b) => Date.parse(iso(a.iniciada_em)) - Date.parse(iso(b.iniciada_em)));
  const segs = ord.map((v) => Number(v.segundos) || 0);
  return {
    aberturas: ord.length,
    reaberturas: Math.max(0, ord.length - 1),
    tempoTotalSeg: segs.reduce((a, b) => a + b, 0),
    maiorSessaoSeg: segs.length ? Math.max(...segs) : 0,
    scrollMax: ord.reduce((a, v) => Math.max(a, Number(v.scroll_max) || 0), 0),
    leuAteOFim: ord.some((v) => Number(v.scroll_max) >= 90),
    primeira: ord.length ? iso(ord[0].iniciada_em) : null,
    ultima: ord.length ? iso(ord[ord.length - 1].iniciada_em) : null,
    dispositivos: [...new Set(ord.map((v) => v.dispositivo))],
  };
}

export function duracao(seg: number): string {
  const s = Math.max(0, Math.floor(seg));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min${s % 60 ? ` ${s % 60}s` : ''}`;
  const min = Math.floor((s % 3600) / 60);
  return `${Math.floor(s / 3600)}h${min ? ` ${min}min` : ''}`;
}
