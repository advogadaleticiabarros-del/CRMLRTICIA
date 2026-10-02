/**
 * "Recebi um pagamento" — regras puras. Valida e normaliza um recebimento
 * que JÁ aconteceu (vira receita + parcela pagas no financeiro).
 */

const FORMAS = ['PIX', 'Transferência', 'Boleto', 'Cartão', 'Dinheiro', 'Depósito judicial', 'Outro'];

function valorBR(v: unknown): number {
  if (typeof v === 'number') return v;
  const t = String(v ?? '').trim().replace(/[R$\s]/g, '');
  if (!t) return 0;
  const n = /,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  return Math.round(Number(n) * 100) / 100 || 0;
}

export interface Recebimento { client_id: number; case_id: number | null; valor: number; data: string; descricao: string; forma: string }

export function validarRecebimento(b: any, hoje: string): { erro: string | null; dados: Recebimento } {
  const dados: Recebimento = {
    client_id: Number(b?.client_id) || 0,
    case_id: Number(b?.case_id) || null,
    valor: valorBR(b?.valor),
    data: /^\d{4}-\d{2}-\d{2}$/.test(String(b?.data || '')) ? String(b.data) : hoje,
    descricao: String(b?.descricao || '').trim().slice(0, 200) || 'Pagamento recebido',
    forma: FORMAS.includes(String(b?.forma)) ? String(b.forma) : 'Outro',
  };
  let erro: string | null = null;
  if (!dados.client_id) erro = 'Escolha o cliente que pagou';
  else if (!(dados.valor > 0)) erro = 'Informe o valor recebido';
  else if (dados.data > hoje) erro = 'A data do recebimento não pode ser futura';
  return { erro, dados };
}

export const FORMAS_PAGAMENTO = FORMAS;
