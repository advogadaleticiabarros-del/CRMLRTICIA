/**
 * Excluir proposta criada errada — regra pura.
 * Só proposta que NÃO foi aceita e não gerou parcelas pode ser excluída: a
 * aceita já virou contrato e lançamentos no financeiro (para essa, use "Recusar"
 * ou ajuste o contrato). Devolve o motivo do bloqueio, ou null se pode excluir.
 */
export function motivoBloqueioExclusao(p: { status?: string | null; aceito_em?: unknown } | null, parcelas: number): string | null {
  if (!p) return 'Proposta não encontrada';
  if (p.status === 'aceita' || p.aceito_em) return 'Esta proposta já foi aceita e gerou contrato e parcelas — não pode ser excluída. Se foi um erro, ajuste o contrato e as parcelas no Financeiro.';
  if (parcelas > 0) return `Esta proposta já tem ${parcelas} parcelas geradas no Financeiro — exclua as parcelas antes.`;
  return null;
}
