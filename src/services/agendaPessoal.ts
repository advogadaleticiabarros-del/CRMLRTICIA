/**
 * Agenda pessoal no mesmo sistema do trabalho (decisão da Dra. Letícia):
 * compromisso pessoal, recado e medicamento — com repetição diária opcional e
 * aviso por WhatsApp no horário. Regras puras aqui; I/O fica em
 * `agendaPessoalJobs.ts`.
 */

export const TIPOS_PESSOAIS = ['pessoal', 'recado', 'medicamento'] as const;
export type TipoPessoal = typeof TIPOS_PESSOAIS[number];

export function ehTipoPessoal(tipo: string | null | undefined): tipo is TipoPessoal {
  return (TIPOS_PESSOAIS as readonly string[]).includes(String(tipo));
}

export interface SerieDiaria {
  start_datetime: string | Date;
  end_datetime: string | Date;
  repeat_until: string | Date | null;
}

const DIA_MS = 86_400_000;
const diaUtc = (d: string | Date) => {
  const iso = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  return Date.parse(iso + 'T00:00:00Z');
};

/**
 * Início/fim da ocorrência da série no dia `dia` (YYYY-MM-DD), mesmo horário
 * da original. `null` no próprio dia da série (a original já existe), antes
 * dela ou depois de `repeat_until`. Brasil não tem horário de verão, então
 * somar dias inteiros em UTC preserva a hora local.
 */
export function ocorrenciaNoDia(serie: SerieDiaria, dia: string): { start: Date; end: Date } | null {
  const inicio = new Date(serie.start_datetime);
  const fim = new Date(serie.end_datetime);
  const deslocamento = diaUtc(dia) - diaUtc(inicio);
  if (deslocamento <= 0) return null;
  if (serie.repeat_until && diaUtc(dia) > diaUtc(serie.repeat_until)) return null;
  return { start: new Date(inicio.getTime() + deslocamento), end: new Date(fim.getTime() + deslocamento) };
}

const ICONE: Record<TipoPessoal, string> = { pessoal: '🗓️', recado: '📌', medicamento: '💊' };
const ROTULO: Record<TipoPessoal, string> = { pessoal: 'Compromisso pessoal', recado: 'Recado', medicamento: 'Hora do remédio' };

export function textoLembrete(ev: { event_type: string; title: string; start_datetime: string | Date; description?: string | null }): string {
  const tipo: TipoPessoal = ehTipoPessoal(ev.event_type) ? ev.event_type : 'pessoal';
  const hora = new Date(ev.start_datetime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  const linhas = [`${ICONE[tipo]} *${ROTULO[tipo]}* (${hora}): ${ev.title}`];
  if (ev.description) linhas.push(ev.description);
  return linhas.join('\n');
}
