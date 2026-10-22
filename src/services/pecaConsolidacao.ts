/**
 * Regra do escritório (Jessica, 21/10/2026): o que for do mesmo cliente contra a
 * mesma parte contrária vai na MESMA petição inicial (ex.: empréstimo + juros
 * abusivos, cartão RMC + RCC contra o mesmo banco). Só junta casos da mesma área
 * que ainda não foram protocolados.
 */

export interface Parte { nome?: string | null; cpf_cnpj?: string | null }

export interface CasoParaJuntar {
  id: number; client_id: number | null; legal_area: string | null;
  production_stage: string | null; partes: Parte[];
}

export const ETAPAS_ANTES_DO_PROTOCOLO = ['em_analise', 'separacao_documentos', 'criacao_inicial', 'revisao_inicial', 'aguardando_protocolo'];

const RUIDO = new Set(['banco', 'sa', 's', 'a', 'ltda', 'me', 'epp', 'eireli', 'cia', 'companhia', 'de', 'do', 'da', 'dos', 'das', 'e']);

export function normalizarNomeParte(nome: string | null | undefined): string {
  return String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/s\s*[./]\s*a\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !RUIDO.has(w))
    .join(' ');
}

/** Os 8 primeiros dígitos do CNPJ identificam a empresa (matriz e filiais). */
function raizCnpj(doc: string | null | undefined): string | null {
  const d = String(doc || '').replace(/\D/g, '');
  return d.length === 14 ? d.slice(0, 8) : null;
}

export function mesmaParte(a: Parte, b: Parte): boolean {
  const ra = raizCnpj(a.cpf_cnpj), rb = raizCnpj(b.cpf_cnpj);
  if (ra && rb) return ra === rb;
  const na = normalizarNomeParte(a.nome), nb = normalizarNomeParte(b.nome);
  return !!na && na === nb;
}

const area = (a: string | null) => String(a || '').trim().toLowerCase();

export function casosCorrelatos<T extends CasoParaJuntar>(alvo: CasoParaJuntar, candidatos: T[]): T[] {
  const vistos = new Set<number>([alvo.id]);
  return candidatos.filter((c) => {
    if (vistos.has(c.id)) return false;
    const junta = c.client_id === alvo.client_id && c.client_id != null
      && area(c.legal_area) === area(alvo.legal_area)
      && ETAPAS_ANTES_DO_PROTOCOLO.includes(String(c.production_stage))
      && c.partes.some((p) => alvo.partes.some((q) => mesmaParte(p, q)));
    if (junta) vistos.add(c.id);
    return junta;
  });
}
