// Tarefas demoradas com barra e confirmação de conclusão (pedido da Jessica, 30/10/2026):
// "toda ação preciso de confirmação de conclusão, pode colocar barras também para
// acompanhamento, exemplo leitura de documentos, atualização de pasta, tudo que eu
// precise esperar para finalizar".
//
// Antes, cada ação demorada (ler a pasta do Drive, ler os contratos, análise, revisão,
// geração da peça) respondia "começou" e só avisava no sino no fim. Agora cada uma vira
// uma tarefa que a tela mostra num painel fixo, com barra e etapa, e o desfecho fica lá
// (concluída ou com o motivo da falha) até a pessoa dar OK. O sino continua avisando.
//
// Fica na memória: o CRM roda num único processo (PM2 crm-juridico). Se o servidor
// reiniciar, as tarefas somem e a tela avisa que a tarefa foi interrompida.

const PRESA_MS = 2 * 60 * 60 * 1000;   // rodando há mais que isso = parou (nunca barra eterna)
const GUARDA_MS = 24 * 60 * 60 * 1000; // terminada não confirmada some depois de um dia
const MAX_POR_PESSOA = 30;

export type EstadoTarefa = 'rodando' | 'concluida' | 'falhou';

export interface NovaTarefa { userId: number; tipo: string; titulo: string; caseId?: number | null; rotulo?: string }

export interface Andamento { rotulo: string; feito?: number | null; total?: number | null }

export interface TarefaVista {
  id: string; tipo: string; titulo: string; caseId: number | null;
  estado: EstadoTarefa; rotulo: string;
  feito: number | null; total: number | null;
  /** 0–100; null = sem contagem (a tela mostra a barra em movimento). */
  pct: number | null;
  resultado: string | null;
  desde: string; fim: string | null; segundos: number;
}

export interface ControleTarefa {
  id: string;
  /** Muda o que a barra mostra. Com feito/total, a barra anda pela contagem. */
  etapa(rotulo: string, feito?: number | null, total?: number | null): void;
  /** O andamento vem de outra fonte, lida a cada consulta (ex.: as etapas da geração da peça). */
  acompanhar(fonte: () => Andamento | null): void;
  concluir(mensagem: string): void;
  falhar(mensagem: string): void;
}

export interface RegistroTarefas {
  iniciar(t: NovaTarefa): ControleTarefa;
  /** Começa a tarefa e roda em segundo plano; o resultado conclui ou falha a tarefa (erro vira falha). */
  rodar(t: NovaTarefa, fn: (c: ControleTarefa) => Promise<{ ok: boolean; mensagem: string }>): ControleTarefa;
  listar(userId: number): TarefaVista[];
  /** O "OK" da pessoa na confirmação de conclusão. */
  dispensar(userId: number, id: string): boolean;
  dispensarTerminadas(userId: number): number;
}

interface Interna {
  id: string; userId: number; tipo: string; titulo: string; caseId: number | null;
  estado: EstadoTarefa; andamento: Andamento; fonte: (() => Andamento | null) | null;
  resultado: string | null; desde: Date; fim: Date | null;
}

export function criarTarefas(opts: { agora?: () => Date } = {}): RegistroTarefas {
  const agora = opts.agora || (() => new Date());
  const tarefas = new Map<string, Interna>();
  let seq = 0;

  const terminar = (t: Interna, estado: EstadoTarefa, msg: string) => {
    if (t.estado !== 'rodando') return; // o primeiro desfecho vale
    if (t.fonte) { const a = safe(t.fonte); if (a) t.andamento = a; t.fonte = null; }
    t.estado = estado; t.resultado = String(msg || '').slice(0, 600); t.fim = agora();
  };

  const faxina = () => {
    const ag = agora().getTime();
    for (const t of tarefas.values()) {
      if (t.estado === 'rodando' && ag - t.desde.getTime() > PRESA_MS) {
        terminar(t, 'falhou', 'A tarefa parou sem resposta (o sistema pode ter sido atualizado no meio). Tente de novo; se repetir, veja o sino.');
      }
      if (t.fim && ag - t.fim.getTime() > GUARDA_MS) tarefas.delete(t.id);
    }
  };

  const vista = (t: Interna): TarefaVista => {
    if (t.fonte) { const a = safe(t.fonte); if (a) t.andamento = a; }
    const { rotulo, feito = null, total = null } = t.andamento;
    let pct: number | null = null;
    if (t.estado !== 'rodando') pct = 100;
    else if (total && total > 0 && feito != null) pct = Math.max(0, Math.min(99, Math.round((feito / total) * 100)));
    const ate = (t.fim || agora()).getTime();
    return {
      id: t.id, tipo: t.tipo, titulo: t.titulo, caseId: t.caseId, estado: t.estado, rotulo,
      feito: feito ?? null, total: total ?? null, pct, resultado: t.resultado,
      desde: t.desde.toISOString(), fim: t.fim ? t.fim.toISOString() : null,
      segundos: Math.max(0, Math.round((ate - t.desde.getTime()) / 1000)),
    };
  };

  const iniciar = (n: NovaTarefa): ControleTarefa => {
    faxina();
    const t: Interna = {
      id: `t${Date.now().toString(36)}${(++seq).toString(36)}`, userId: n.userId, tipo: n.tipo, titulo: n.titulo,
      caseId: n.caseId ?? null, estado: 'rodando', andamento: { rotulo: n.rotulo || 'Começando' }, fonte: null,
      resultado: null, desde: agora(), fim: null,
    };
    tarefas.set(t.id, t);
    // Limite por pessoa: some primeiro a terminada mais antiga.
    const dela = [...tarefas.values()].filter((x) => x.userId === n.userId && x.estado !== 'rodando');
    while (dela.length && [...tarefas.values()].filter((x) => x.userId === n.userId).length > MAX_POR_PESSOA) tarefas.delete(dela.shift()!.id);
    return {
      id: t.id,
      etapa(rotulo, feito = null, total = null) { if (t.estado === 'rodando') t.andamento = { rotulo, feito, total }; },
      acompanhar(fonte) { if (t.estado === 'rodando') t.fonte = fonte; },
      concluir(msg) { terminar(t, 'concluida', msg); },
      falhar(msg) { terminar(t, 'falhou', msg); },
    };
  };

  return {
    iniciar,
    rodar(n, fn) {
      const c = iniciar(n);
      Promise.resolve()
        .then(() => fn(c))
        .then((r) => (r.ok ? c.concluir(r.mensagem) : c.falhar(r.mensagem)))
        .catch((e: any) => c.falhar(e?.message || 'Erro desconhecido'));
      return c;
    },
    listar(userId) {
      faxina();
      const dela = [...tarefas.values()].filter((t) => t.userId === userId);
      const rodando = dela.filter((t) => t.estado === 'rodando').sort((a, b) => a.desde.getTime() - b.desde.getTime());
      const feitas = dela.filter((t) => t.estado !== 'rodando').sort((a, b) => b.fim!.getTime() - a.fim!.getTime());
      return [...rodando, ...feitas].map(vista);
    },
    dispensar(userId, id) {
      const t = tarefas.get(id);
      if (!t || t.userId !== userId || t.estado === 'rodando') return false;
      return tarefas.delete(id);
    },
    dispensarTerminadas(userId) {
      let n = 0;
      for (const t of [...tarefas.values()]) if (t.userId === userId && t.estado !== 'rodando') { tarefas.delete(t.id); n++; }
      return n;
    },
  };
}

function safe(f: () => Andamento | null): Andamento | null {
  try { return f(); } catch { return null; }
}

/** O registro do servidor (um só para todas as rotas). */
export const tarefasEmAndamento = criarTarefas();
