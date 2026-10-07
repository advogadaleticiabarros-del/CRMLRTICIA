/**
 * Uma audiência é UMA, mesmo que esteja copiada na agenda de mais de um
 * usuário (07/10/2026: a audiência da Larissa veio do Google para o
 * Administrador e para a Dra. Letícia, e o cliente recebeu o lembrete 2 vezes).
 * A agenda continua por usuário; quem manda mensagem para FORA (cliente,
 * parceiro) deve agrupar por esta chave: cliente (ou caso) + horário.
 */
export interface EventoAudiencia { id: number; client_id?: number | null; case_id?: number | null; start_datetime: Date | string }

function minutoIso(d: Date | string): string {
  if (d instanceof Date) return d.toISOString().slice(0, 16);
  const s = String(d).trim().replace(' ', 'T');
  return (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? new Date(s).toISOString() : s).slice(0, 16);
}

export function chaveAudiencia(e: EventoAudiencia): string {
  const quem = e.client_id ? `cl${e.client_id}` : e.case_id ? `ca${e.case_id}` : `ev${e.id}`;
  return `${quem}_${minutoIso(e.start_datetime)}`;
}

/** Agrupa as cópias: devolve um item por audiência (o 1º evento) com os ids de todas as cópias. */
export function agruparAudiencias<T extends EventoAudiencia>(eventos: T[]): { chave: string; evento: T; ids: number[] }[] {
  const grupos = new Map<string, { chave: string; evento: T; ids: number[] }>();
  for (const e of eventos) {
    const chave = chaveAudiencia(e);
    const g = grupos.get(chave);
    if (g) g.ids.push(e.id); else grupos.set(chave, { chave, evento: e, ids: [e.id] });
  }
  return [...grupos.values()];
}
