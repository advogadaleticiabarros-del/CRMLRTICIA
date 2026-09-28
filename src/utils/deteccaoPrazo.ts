/**
 * Identificação do tipo de prazo a partir do texto de uma movimentação
 * (sugestão — a advogada confirma). Ideia 6 da auditoria de Processos e prazos
 * (28/09/2026): antes valia o PRIMEIRO gatilho da lista que batesse no texto
 * inteiro; agora vale o mais específico, e o título do ato pesa mais que a
 * descrição.
 */
export interface Gatilho { re: RegExp; type: string; days: number; marco?: boolean }

/** Atos que definem o prazo por si só. sentença/acórdão são MARCO do processo (aviso no WhatsApp). */
export const GATILHOS_ESPECIFICOS: Gatilho[] = [
  { re: /senten[çc]a/i,   type: 'Recurso (apelação)', days: 15, marco: true },
  { re: /ac[óo]rd[ãa]o/i, type: 'Recurso',            days: 15, marco: true },
  { re: /cita[çc][ãa]o/i, type: 'Contestação',        days: 15 },
  { re: /embargos/i,      type: 'Embargos',           days: 5 },
];

/** Palavras genéricas: só valem quando nada específico aparece. */
export const GATILHOS_GENERICOS: Gatilho[] = [
  { re: /intima[çc][ãa]o/i,     type: 'Manifestação', days: 15 },
  { re: /decis[ãa]o|despacho/i, type: 'Manifestação', days: 5 },
  { re: /publica[çc][ãa]o/i,    type: 'Manifestação', days: 15 },
];

// Sem acento nem maiúscula: "SENTENCA" e "acordao" também batem.
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

function primeiroDoGrupo(texto: string, grupo: Gatilho[]): Gatilho | null {
  let melhor: Gatilho | null = null;
  let pos = Infinity;
  for (const g of grupo) {
    const m = texto.match(g.re);
    if (m && m.index !== undefined && m.index < pos) { melhor = g; pos = m.index; }
  }
  return melhor;
}

export function identificarGatilho(titulo: string | null | undefined, descricao: string | null | undefined): Gatilho | null {
  const textos = [semAcento(titulo || ''), semAcento(descricao || '')];
  for (const grupo of [GATILHOS_ESPECIFICOS, GATILHOS_GENERICOS]) {
    for (const t of textos) {
      const achou = primeiroDoGrupo(t, grupo);
      if (achou) return achou;
    }
  }
  return null;
}
