// src/services/whatsappSeveridade.ts
// Classificação de urgência de uma conversa de WhatsApp para a lista de
// Conversas — mesmos limiares do Briefing Jurídico Matinal (briefingSeverity.ts),
// para manter o mesmo vocabulário visual em todo o CRM. Ver spec
// docs/superpowers/specs/2026-08-21-whatsapp-conversas-redesign.md.
export type SeveridadeConversa = 'critica' | 'atencao' | 'neutra';

export interface ChatPendencia {
  proxima_audiencia_dias: number | null;
  parcela_vencendo_dias: number | null;
}

function severidadeAudiencia(dias: number | null): SeveridadeConversa {
  if (dias === null) return 'neutra';
  if (dias <= 2) return 'critica';
  if (dias <= 7) return 'atencao';
  return 'neutra';
}

function severidadeParcela(dias: number | null): SeveridadeConversa {
  if (dias === null) return 'neutra';
  if (dias <= 0) return 'critica';
  if (dias <= 3) return 'atencao';
  return 'neutra';
}

const PESO: Record<SeveridadeConversa, number> = { critica: 2, atencao: 1, neutra: 0 };

export function severidadeConversa(chat: ChatPendencia): SeveridadeConversa {
  const a = severidadeAudiencia(chat.proxima_audiencia_dias);
  const p = severidadeParcela(chat.parcela_vencendo_dias);
  return PESO[a] >= PESO[p] ? a : p;
}

/** Etiqueta (pill) de UMA pendência crítica/de atenção real — a mais urgente entre as duas. */
export function etiquetaPendencia(chat: ChatPendencia): { icone: 'scale' | 'banknote'; texto: string } | null {
  const a = severidadeAudiencia(chat.proxima_audiencia_dias);
  const p = severidadeParcela(chat.parcela_vencendo_dias);
  if (a === 'neutra' && p === 'neutra') return null;
  const audienciaGanha = PESO[a] >= PESO[p];
  if (audienciaGanha) {
    const d = chat.proxima_audiencia_dias as number;
    const texto = d === 0 ? 'Audiência hoje' : d === 1 ? 'Audiência amanhã' : `Audiência em ${d} dias`;
    return { icone: 'scale', texto };
  }
  const d = chat.parcela_vencendo_dias as number;
  const texto = d < 0 ? 'Parcela atrasada' : d === 0 ? 'Parcela vence hoje' : `Parcela vence em ${d} dia${d === 1 ? '' : 's'}`;
  return { icone: 'banknote', texto };
}
