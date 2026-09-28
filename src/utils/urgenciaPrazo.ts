/** Nível de urgência de um prazo pelos dias de calendário que faltam (negativo = vencido). */
export function nivelUrgencia(dias: number) {
  if (dias < 0) return 'vencido';
  if (dias <= 1) return 'critico';
  if (dias <= 3) return 'alto';
  if (dias <= 7) return 'atencao';
  return 'normal';
}

/** Dias de calendário de hoje (YYYY-MM-DD) até o vencimento (YYYY-MM-DD). */
export function diasAte(vencimentoISO: string, hojeISO: string) {
  const a = Date.UTC(+vencimentoISO.slice(0, 4), +vencimentoISO.slice(5, 7) - 1, +vencimentoISO.slice(8, 10));
  const b = Date.UTC(+hojeISO.slice(0, 4), +hojeISO.slice(5, 7) - 1, +hojeISO.slice(8, 10));
  return Math.round((a - b) / 86400000);
}
