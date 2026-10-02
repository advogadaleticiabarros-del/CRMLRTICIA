/**
 * Detecta acordo nas movimentações processuais — regras puras.
 * Relato real (02/10/2026): acordos homologados chegavam pelo DataJud/DJEN
 * ("Homologação de Transação", "foi homologado acordo") e nada acontecia.
 *  - 'homologado': juiz homologou acordo/transação/conciliação;
 *  - 'proposto': petição/termo de acordo juntado, partes informam acordo.
 * Não confunde com "Homologação de Decisão de Juiz Leigo" (é sentença) nem
 * com "sem acordo"/"não chegaram a acordo".
 */

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const NEGATIVO = /\b(sem acordo|nao (houve|chegaram a|foi possivel o?)\s*acordo|acordo (nao|infrutifer)|conciliacao infrutifera|inexitosa)\b/;

const HOMOLOGADO: RegExp[] = [
  /homologa\w*\s+(de\s+|o\s+|a\s+)?(acordo|transacao|conciliacao)/,
  /homologad[oa]\s+(o\s+|a\s+)?(acordo|transacao|conciliacao)/,
  /(acordo|transacao|conciliacao)\s+(foi\s+)?homologad[oa]/,
  /homologo\s+(o\s+|a\s+)?(acordo|transacao|conciliacao)/,
  /sentenca\s+homologatoria\s+de\s+(acordo|transacao)/,
];

const PROPOSTO: RegExp[] = [
  /(peticao|termo|minuta)\s+de\s+acordo/,
  /(celebraram|firmaram|realizaram|entabularam)\s+(um\s+)?acordo/,
  /informa\w*\s+(a\s+)?(realizacao|celebracao)\s+de\s+acordo/,
];

export interface AcordoDetectado { tipo: 'homologado' | 'proposto'; valorSugerido: number | null }

function maiorValor(texto: string): number | null {
  const vals = [...texto.matchAll(/r\$\s*([\d.]+,\d{2})/gi)].map((m) => Number(m[1].replace(/\./g, '').replace(',', '.')));
  return vals.length ? Math.max(...vals) : null;
}

export function detectarAcordo(texto: string): AcordoDetectado | null {
  const t = norm(String(texto || ''));
  if (!t.trim() || NEGATIVO.test(t)) return null;
  if (/juiz leigo/.test(t) && !/acordo|transacao|conciliacao/.test(t)) return null;
  if (HOMOLOGADO.some((re) => re.test(t))) return { tipo: 'homologado', valorSugerido: maiorValor(texto) };
  if (PROPOSTO.some((re) => re.test(t))) return { tipo: 'proposto', valorSugerido: maiorValor(texto) };
  return null;
}
