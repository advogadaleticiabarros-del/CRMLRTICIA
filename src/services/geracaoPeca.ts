// Geração da petição inicial pela esteira — ponto único para as duas portas de entrada
// (botão "nova versão" e o card entrando em "Criação inicial"): trava por peça, registro
// no banco enquanto gera, aviso no sino e retomada depois de um reinício.
//
// Por que o registro (30/10/2026): a Jessica pediu uma nova versão e ela nunca chegou.
// Uma publicação reiniciou o CRM no meio da geração, que vive só na memória: sem peça e
// sem aviso. Agora o pedido fica em `geracoes_peca_pendentes` até terminar e, quando o
// CRM volta, `retomar()` gera de novo o que ficou pela metade. Uma geração que já caiu
// MAX_TENTATIVAS vezes (ex.: ela mesma derruba o servidor) não volta mais: vira aviso.

import type { TravaGeracao } from './travaGeracaoPeca';

const MAX_TENTATIVAS = 2;

export interface PedidoGeracao {
  /** Caso dono da peça (o principal, se o pedido foi unido a outro processo): chave da trava. */
  alvo: number;
  caseId: number;
  userId: number;
  /** manual = "gerar nova versão" (sempre versão nova); etapa = card entrou em "Criação inicial" (só a 1ª, e revisa). */
  origem: 'manual' | 'etapa';
  titulo: string | null;
}
export interface Pendente extends PedidoGeracao { tentativas: number }

export interface ResumoRevisao { itens_ok: number; itens_verificados: number; pendencias_criticas: number }

export interface DepsGeracao {
  trava: TravaGeracao;
  gerar(caseId: number, userId: number, force: boolean): Promise<{ ok: boolean; version?: number; message?: string; casos?: number[] }>;
  revisar(caseId: number, userId: number): Promise<ResumoRevisao | null>;
  avisar(a: { userId: number; caseId: number; ok: boolean; titulo: string; mensagem: string }): Promise<void>;
  /** Painel de tarefas da tela (barra + confirmação de conclusão, 30/10/2026). Opcional. */
  tarefa?(p: Pendente, retomada: boolean): { concluir(mensagem: string): void; falhar(mensagem: string): void };
  pendentes: {
    guardar(p: Pendente): Promise<void>;
    apagar(alvo: number): Promise<void>;
    listar(): Promise<Pendente[]>;
  };
}

export function criarGeracaoPeca(deps: DepsGeracao) {
  const rodando = new Set<Promise<void>>();
  const quieto = <T>(p: Promise<T>) => p.catch(() => undefined);

  async function executar(p: Pendente, retomada: boolean, painel: { concluir(m: string): void; falhar(m: string): void }): Promise<void> {
    const nome = p.titulo || 'Processo';
    const prefixo = retomada ? 'Retomada depois de uma atualização do sistema. ' : '';
    try {
      await quieto(deps.pendentes.guardar(p));
      const r = await deps.gerar(p.caseId, p.userId, p.origem === 'manual');
      if (!r.ok) {
        painel.falhar(r.message || 'Erro desconhecido');
        await quieto(deps.avisar({ userId: p.userId, caseId: p.caseId, ok: false, titulo: 'Falha ao gerar a petição inicial', mensagem: `${prefixo}${nome} — ${r.message || 'Erro desconhecido'}` }));
        return;
      }
      let rev = '';
      if (p.origem === 'etapa') {
        deps.trava.marcar(p.alvo, 'revisao');
        const s = await deps.revisar(p.caseId, p.userId).catch(() => null);
        if (s) rev = ` Revisão automática: ${s.itens_ok}/${s.itens_verificados} itens OK${s.pendencias_criticas ? `, ${s.pendencias_criticas} pendência(s) crítica(s)` : ''}.`;
      }
      const versao = r.version ? `v${r.version} pronta` : 'pronta';
      const conjunta = (r.casos?.length || 0) > 1 ? ` (peça conjunta de ${r.casos!.length} casos)` : '';
      painel.concluir(`Peça ${versao}${conjunta}. Abra a mesa do caso para conferir.${rev}`);
      await quieto(deps.avisar({
        userId: p.userId, caseId: p.caseId, ok: true, titulo: 'Petição inicial gerada',
        mensagem: `${prefixo}${nome} — ${versao}${conjunta}. Confira a petição e o "Dossiê da peça" em Documentos do caso.${rev}`,
      }));
    } catch (e: any) {
      painel.falhar(e?.message || 'Erro desconhecido');
      await quieto(deps.avisar({ userId: p.userId, caseId: p.caseId, ok: false, titulo: 'Falha ao gerar a petição inicial', mensagem: `${prefixo}${nome} — ${e?.message || 'Erro desconhecido'}` }));
    } finally {
      await quieto(deps.pendentes.apagar(p.alvo));
    }
  }

  function iniciar(p: Pendente, retomada: boolean): boolean {
    if (!deps.trava.iniciar(p.alvo)) return false;
    let painel = { concluir: (_m: string) => {}, falhar: (_m: string) => {} };
    try { if (deps.tarefa) painel = deps.tarefa(p, retomada); } catch { /* o painel nunca impede a geração */ }
    const t = executar(p, retomada, painel).finally(() => { deps.trava.terminar(p.alvo); rodando.delete(t); });
    rodando.add(t);
    return true;
  }

  return {
    /** Começa a geração em segundo plano. false = a peça já está sendo gerada. */
    pedir(p: PedidoGeracao): boolean {
      return iniciar({ ...p, tentativas: 0 }, false);
    },
    /** No início do CRM: gera de novo o que um reinício interrompeu. Devolve quantas retomou. */
    async retomar(): Promise<number> {
      const lista = await deps.pendentes.listar().catch(() => [] as Pendente[]);
      let n = 0;
      for (const p of lista) {
        if (deps.trava.emAndamento(p.alvo)) continue;
        if (p.tentativas >= MAX_TENTATIVAS) {
          await quieto(deps.pendentes.apagar(p.alvo));
          await quieto(deps.avisar({
            userId: p.userId, caseId: p.caseId, ok: false, titulo: 'Geração da petição interrompida',
            mensagem: `${p.titulo || 'Processo'} — a geração foi interrompida ${p.tentativas + 1} vezes por reinício do sistema e não será retomada sozinha. Peça de novo pela mesa do caso.`,
          }));
          continue;
        }
        if (iniciar({ ...p, tentativas: p.tentativas + 1 }, true)) n++;
      }
      return n;
    },
    /** Espera as gerações em andamento (testes). */
    async ocioso(): Promise<void> { while (rodando.size) await Promise.all([...rodando]); },
  };
}
