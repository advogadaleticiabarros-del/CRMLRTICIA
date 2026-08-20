/**
 * Classificador de severidade do briefing matinal — regra fixa por tipo de
 * item (não delegada a IA), para ser previsível e auditável. Ver seção 3 do
 * spec docs/superpowers/specs/2026-08-21-briefing-matinal-design.md.
 */
export type Severity = 'critica' | 'atencao' | 'acompanhamento' | 'pode_esperar';

export interface BriefingItem {
  id: string;
  kind: 'prazo' | 'agenda' | 'pagamento' | 'movimentacao' | 'esteira' | 'lead' | 'email_parceria';
  label: string;
  severity: Severity;
  /** Menor valor = mais urgente dentro do mesmo kind. Usado só para desempatar o top3. */
  ordemDesempate: number;
}

export function classificarPrazo(diasParaVencer: number): Severity {
  if (diasParaVencer <= 1) return 'critica';
  if (diasParaVencer <= 3) return 'atencao';
  return 'acompanhamento';
}

export function classificarAgenda(ehHoje: boolean): Severity {
  return ehHoje ? 'critica' : 'acompanhamento';
}

export function classificarPagamento(diasParaVencer: number): Severity {
  if (diasParaVencer <= 0) return 'critica';
  if (diasParaVencer <= 3) return 'atencao';
  return 'pode_esperar';
}

export function classificarMovimentacao(prioridadeIA: 'Alta' | 'Média' | 'Baixa' | null): Severity {
  if (prioridadeIA === 'Alta') return 'critica';
  if (prioridadeIA === 'Média') return 'atencao';
  return 'acompanhamento';
}

export function classificarEsteira(diasParado: number): Severity {
  return diasParado > 10 ? 'atencao' : 'pode_esperar';
}

export function classificarLead(horasSemResposta: number): Severity {
  return horasSemResposta < 48 ? 'acompanhamento' : 'pode_esperar';
}

// Ordem de prioridade entre TIPOS de item quando dois itens críticos empatam
// em ordemDesempate — ver seção 3 do spec: "prazo fatal > audiência/reunião >
// tutela/liminar > movimentação prioridade alta > pagamento".
const PESO_KIND: Record<BriefingItem['kind'], number> = {
  prazo: 0, agenda: 1, movimentacao: 2, pagamento: 3, esteira: 4, lead: 5, email_parceria: 6,
};

/** Os até 3 itens críticos de maior urgência, para o fecho "3 prioridades do dia". Determinístico. */
export function top3(itens: BriefingItem[]): BriefingItem[] {
  return itens
    .filter((i) => i.severity === 'critica')
    .sort((a, b) => a.ordemDesempate - b.ordemDesempate || PESO_KIND[a.kind] - PESO_KIND[b.kind])
    .slice(0, 3);
}
