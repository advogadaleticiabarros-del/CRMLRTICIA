/**
 * Regras das consultas que o Claude faz ao CRM (extensão, 28/11/2026).
 * Só funções puras; o acesso ao banco fica em claudeConsultasMysql.ts.
 */

/** Números de processo (20 dígitos, com ou sem máscara CNJ) e CPFs citados num texto. */
export function extrairPistas(texto: string): { processos: string[]; cpfs: string[] } {
  const t = String(texto || '');
  const processos = new Set<string>();
  for (const m of t.matchAll(/\b\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}\b/g)) {
    const d = m[0].replace(/\D/g, '');
    if (d.length === 20) processos.add(d);
  }
  const cpfs = new Set<string>();
  for (const m of t.matchAll(/(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g)) {
    const d = m[0].replace(/\D/g, '');
    if (d.length === 11 && !/^(\d)\1{10}$/.test(d)) cpfs.add(d);
  }
  return { processos: [...processos], cpfs: [...cpfs] };
}

export type Certeza = 'certo' | 'duvida' | 'nenhum';

/**
 * Processo encontrado pelo número: certo. Pelo nome/CPF: certo se só um caso
 * bate, dúvida se vários. O Claude age sozinho só no "certo"; na dúvida, pergunta.
 */
export function grauDeCerteza(n: { porProcesso: number; porNome: number }): Certeza {
  if (n.porProcesso === 1) return 'certo';
  if (n.porProcesso > 1) return 'duvida';
  if (n.porNome === 1) return 'certo';
  if (n.porNome > 1) return 'duvida';
  return 'nenhum';
}
