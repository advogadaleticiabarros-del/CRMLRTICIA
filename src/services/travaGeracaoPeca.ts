// Trava da geração da peça (pedido da Jessica, 30/10/2026): "trave o botão depois
// do primeiro clique, até chegar a versão". Enquanto a esteira gera a peça de um
// caso, um segundo pedido para o mesmo caso é recusado (sem versão repetida e sem
// pagar a IA duas vezes). Peças de casos diferentes continuam em paralelo.
//
// Fica na memória: o CRM roda num único processo (PM2 crm-juridico). Se o servidor
// reiniciar no meio, a geração se perde junto com a trava. Uma trava esquecida
// solta sozinha depois de MAX_MS, para nunca prender o botão para sempre.

const MAX_MS = 30 * 60 * 1000;

/** Etapas da geração, na ordem, para a barra de progresso da tela ("é muito difícil ficar aguardando sem saber de nada"). */
export const ETAPAS_GERACAO = [
  { id: 'inicio', rotulo: 'Começando' },
  { id: 'leitura', rotulo: 'Dra. Helena lendo os documentos' },
  { id: 'calculos', rotulo: 'Calculando o indébito e a planilha' },
  { id: 'estrategia', rotulo: 'Escolhendo a estratégia e o modelo' },
  { id: 'fundamentos', rotulo: 'Dra. Júlia separando os fundamentos' },
  { id: 'redacao', rotulo: 'Redigindo a petição (a etapa mais longa)' },
  { id: 'conferencia', rotulo: 'Conferindo os valores na peça' },
  { id: 'salvando', rotulo: 'Salvando a peça, a planilha e o demonstrativo' },
  { id: 'revisao', rotulo: 'Revisão automática da peça' },
] as const;

export type EtapaGeracao = typeof ETAPAS_GERACAO[number]['id'];

export interface Andamento { desde: Date; etapa: EtapaGeracao; rotulo: string; passo: number; total: number }

export interface TravaGeracao {
  /** Reserva a peça do caso. false = já está sendo gerada. */
  iniciar(caseId: number): boolean;
  terminar(caseId: number): void;
  emAndamento(caseId: number): Andamento | null;
  /** Avança a etapa da peça que está sendo gerada (sem trava, não faz nada). */
  marcar(caseId: number, etapa: EtapaGeracao): void;
  /** Roda a tarefa com a trava; não roda se a peça já está sendo gerada. Solta a trava mesmo se a tarefa falhar. */
  executar<T>(caseId: number, tarefa: () => Promise<T>): Promise<{ iniciou: boolean; valor?: T }>;
}

export function criarTravaGeracao(opts: { agora?: () => Date } = {}): TravaGeracao {
  const agora = opts.agora || (() => new Date());
  const ativas = new Map<number, { desde: Date; etapa: EtapaGeracao }>();

  const emAndamento = (caseId: number): Andamento | null => {
    const a = ativas.get(caseId);
    if (!a) return null;
    if (agora().getTime() - a.desde.getTime() > MAX_MS) { ativas.delete(caseId); return null; }
    const i = ETAPAS_GERACAO.findIndex((e) => e.id === a.etapa);
    return { desde: a.desde, etapa: a.etapa, rotulo: ETAPAS_GERACAO[i].rotulo, passo: i + 1, total: ETAPAS_GERACAO.length };
  };
  const iniciar = (caseId: number) => {
    if (emAndamento(caseId)) return false;
    ativas.set(caseId, { desde: agora(), etapa: 'inicio' });
    return true;
  };
  const marcar = (caseId: number, etapa: EtapaGeracao) => {
    const a = ativas.get(caseId);
    if (a) a.etapa = etapa;
  };
  const terminar = (caseId: number) => { ativas.delete(caseId); };

  return {
    iniciar, terminar, emAndamento, marcar,
    async executar(caseId, tarefa) {
      if (!iniciar(caseId)) return { iniciou: false };
      try { return { iniciou: true, valor: await tarefa() }; } finally { terminar(caseId); }
    },
  };
}

/** A trava do servidor (uma só para as rotas e o gatilho de "Criação inicial"). */
export const travaGeracaoPeca = criarTravaGeracao();
