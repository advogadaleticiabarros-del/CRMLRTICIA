/**
 * SLA da esteira de produção — o relógio PAUSA enquanto o caso tem uma
 * pendência aberta (ex.: documento faltando do cliente). O atraso nesse
 * caso não é do escritório, então não deve contar contra o SLA.
 *
 * Fragmentos SQL reutilizados nas 5 consultas que calculam "dias parado"
 * (Kanban, Dashboard de Produção, Controladoria, portal do parceiro) —
 * cálculo único para nunca mais divergir entre telas.
 */

/** Soma a duração de cada pendência (aberta ou já resolvida) do caso, em dias. */
export function diasPausadosSql(caseIdRef: string): string {
  return `(SELECT COALESCE(SUM(DATEDIFF(COALESCE(pn.resolved_at, NOW()), pn.created_at)), 0)
             FROM production_notes pn
            WHERE pn.case_id = ${caseIdRef} AND pn.kind = 'pendencia')`;
}

/** Dias efetivos = dias corridos desde o início da produção, menos os pausados. */
export function slaDiasEfetivosSql(caseIdRef: string, startedAtRef: string): string {
  return `GREATEST(0, DATEDIFF(NOW(), ${startedAtRef}) - ${diasPausadosSql(caseIdRef)})`;
}

/** Quantas pendências do caso estão abertas agora (>0 = SLA pausado neste momento). */
export function pendenciasAbertasSql(caseIdRef: string): string {
  return `(SELECT COUNT(*) FROM production_notes pn
            WHERE pn.case_id = ${caseIdRef} AND pn.kind = 'pendencia' AND pn.resolved = 0)`;
}
