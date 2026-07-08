/**
 * Converte entrada de dinheiro digitada pelo usuário em número.
 * Aceita "1.500,50" (pt-BR), "1500.50", "1500", "R$ 1.500,50".
 * Retorna null para vazio/inválido/não-positivo.
 */
export function parseValorBR(input: unknown): number | null {
  if (input === undefined || input === null) return null;
  const s = String(input).replace(/[R$\s]/g, '');
  if (!s) return null;
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}
