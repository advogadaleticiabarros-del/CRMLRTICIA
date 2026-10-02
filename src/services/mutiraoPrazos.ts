/**
 * Mutirão de prazos detectados a confirmar — regras puras.
 * Separa pelo vencimento calculado (CPC, já com feriados): urgente (vence em
 * até 5 dias), demais, e vencidos (provavelmente já tratados fora do CRM).
 * Marca duplicados: mesmo processo (ignorando a máscara) e mesmo tipo.
 */

export type Grupo = 'urgente' | 'normal' | 'vencido';

const DIA = 86_400_000;

export function classificar(vencimento: string, hoje: string): Grupo {
  const dias = Math.round((Date.parse(vencimento.slice(0, 10)) - Date.parse(hoje.slice(0, 10))) / DIA);
  if (dias < 0) return 'vencido';
  if (dias <= 5) return 'urgente';
  return 'normal';
}

const ORDEM: Record<Grupo, number> = { urgente: 0, normal: 1, vencido: 2 };

export function organizar<T extends { id: number; process_number: string | null; suggested_type: string | null; vencimento: string }>(
  itens: T[], hoje: string
): (T & { grupo: Grupo; duplicado_de: number | null })[] {
  const primeiro = new Map<string, number>();
  const comGrupo = [...itens]
    .sort((a, b) => a.id - b.id)
    .map((i) => {
      const chave = `${String(i.process_number || '').replace(/\D/g, '')}|${String(i.suggested_type || '').toLowerCase()}`;
      const dup = primeiro.get(chave) ?? null;
      if (dup === null) primeiro.set(chave, i.id);
      return { ...i, grupo: classificar(i.vencimento, hoje), duplicado_de: dup };
    });
  return comGrupo.sort((a, b) =>
    ORDEM[a.grupo] - ORDEM[b.grupo] || a.vencimento.localeCompare(b.vencimento) || a.id - b.id);
}
