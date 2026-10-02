/**
 * Tarefa automática "Analisar <tipo> — proc. <nº>" criada a cada intimação
 * detectada. Ela espelha o prazo detectado: fecha sozinha quando o prazo é
 * confirmado ou descartado. Regras puras (o vínculo fica em
 * tasks.detected_deadline_id; títulos antigos são ligados pelo nº do processo).
 */

const TITULO = /^Analisar\s+(.+?)(?:\s+—\s+proc\.\s+(.+))?$/;
const TIPOS_CONHECIDOS = /^(Contesta|R[eé]plica|Recurso|Manifesta|Embargos|Apela|Agravo|Contrarraz|Impugna|Cumprimento|Senten|Prazo|Intima|Audi[eê]ncia|Emenda|Especifica|Alega|Memoriais|Pagamento|Cita)/i;

export function lerTituloAnalisar(titulo: string): { tipo: string; digitos: string | null } | null {
  const m = String(titulo || '').trim().match(TITULO);
  if (!m || !TIPOS_CONHECIDOS.test(m[1].trim())) return null;
  return { tipo: m[1].trim(), digitos: m[2] ? m[2].replace(/\D/g, '') || null : null };
}

export function deveFechar(statusPrazoDetectado: string | null | undefined): boolean {
  return statusPrazoDetectado === 'confirmado' || statusPrazoDetectado === 'descartado';
}
