/**
 * Ponte do escritório (18/11/2026).
 *
 * O TJES fica atrás de um firewall (CloudFront) que bloqueia o IP da VPS com
 * HTTP 403, mas aceita a rede do escritório. Para os sistemas marcados com
 * `viaEscritorio` (sistemas.ts), o cliente MNI não chama o tribunal direto:
 * usa o `fetch` desta ponte, que põe o pedido numa fila EM MEMÓRIA. O programa
 * do computador do escritório (scripts/ponte-escritorio/ponte.mjs) busca os
 * pedidos (espera longa), envia ao tribunal e devolve a resposta.
 *
 * - Nada é gravado: o pedido (que leva o login, como qualquer chamada MNI) vive
 *   só na memória até a resposta chegar ou o prazo acabar.
 * - Sem o computador conectado, falha NA HORA com mensagem clara (sem esperar
 *   o prazo), e a rodada segue para os outros sistemas.
 * - Funciona porque o CRM roda num processo só (PM2 fork, rotinas no mesmo
 *   processo). Se um dia rodar em mais de um processo, a fila precisa ir para
 *   o banco.
 */
import { randomBytes } from 'crypto';
import { ErroRespostaMni, Fetch } from './cliente';

export interface PedidoPonte {
  id: string; url: string; corpo: string; cabecalhos: Record<string, string>;
  /** Pedido ao SITE do tribunal (robô do PJe-JT, TRT17): método, cookies e sem seguir redirecionamento. */
  web?: boolean;
  metodo?: 'GET' | 'POST';
}
export type RespostaPonte = { status: number; corpo: string; cabecalhos?: Record<string, string | string[]> } | { erro: string };

export interface Ponte {
  /** Mesmo formato do fetch que o cliente MNI recebe. */
  fetch: Fetch;
  /** Pedido ao site do tribunal (robô do PJe-JT): devolve também os cabeçalhos (cookies, redirecionamento). */
  requisitar(p: { url: string; metodo: 'GET' | 'POST'; cabecalhos: Record<string, string>; corpo?: string }): Promise<{ status: number; corpo: string; cabecalhos: Record<string, string | string[]> }>;
  /** Chamado pelo computador do escritório: devolve os pedidos novos (espera até `esperaMs` se não houver). */
  aguardarPedidos(esperaMs: number): Promise<PedidoPonte[]>;
  /** Resposta do computador do escritório. false = pedido desconhecido ou já encerrado. */
  responder(id: string, r: RespostaPonte): boolean;
  situacao(): { conectada: boolean; ultimoContato: Date | null };
}

interface Pendente {
  pedido: PedidoPonte;
  entregue: boolean;
  resolver(r: RespostaPonte): void;
}

export function criarPonte(opts: { agora?: () => number; prazoRespostaMs?: number; toleranciaContatoMs?: number } = {}): Ponte {
  const agora = opts.agora ?? (() => Date.now());
  const prazoRespostaMs = opts.prazoRespostaMs ?? 90_000;
  // O programa do escritório busca a cada ~25 s; 90 s sem contato = desligado.
  const toleranciaContatoMs = opts.toleranciaContatoMs ?? 90_000;

  const pendentes = new Map<string, Pendente>();
  let ultimoContato: number | null = null;
  let aguardando = 0;
  let acordar: Array<() => void> = [];

  const conectada = () => aguardando > 0 || (ultimoContato != null && agora() - ultimoContato <= toleranciaContatoMs);
  const naoEntregues = () => [...pendentes.values()].filter((p) => !p.entregue);

  function entregar(): PedidoPonte[] {
    const lista = naoEntregues();
    lista.forEach((p) => { p.entregue = true; });
    return lista.map((p) => p.pedido);
  }

  async function enviar(base: Omit<PedidoPonte, 'id'>, signal?: AbortSignal): Promise<{ status: number; corpo: string; cabecalhos?: Record<string, string | string[]> }> {
    if (!conectada()) {
      throw new ErroRespostaMni('O computador do escritório não está conectado (a consulta ao tribunal passa por ele, porque o tribunal bloqueia o servidor do CRM). Ligue o computador do escritório e tente de novo.');
    }
    const id = randomBytes(12).toString('hex');
    const resposta = await new Promise<RespostaPonte>((resolve) => {
      const semResposta = () => {
        clearTimeout(timer);
        pendentes.delete(id);
        resolve({ erro: 'o computador do escritório não respondeu a tempo' });
      };
      const timer = setTimeout(semResposta, prazoRespostaMs);
      signal?.addEventListener('abort', semResposta, { once: true });
      pendentes.set(id, {
        pedido: { id, ...base },
        entregue: false,
        resolver: (r) => { clearTimeout(timer); signal?.removeEventListener('abort', semResposta); pendentes.delete(id); resolve(r); },
      });
      const a = acordar; acordar = []; a.forEach((f) => f());
    });
    if ('erro' in resposta) throw new ErroRespostaMni(`Consulta pelo computador do escritório falhou: ${String(resposta.erro).slice(0, 200)}`);
    return resposta;
  }

  return {
    async fetch(url, init) {
      const cabecalhos: Record<string, string> = {};
      for (const [k, v] of Object.entries(init.headers || {})) if (/^(content-type|soapaction)$/i.test(k)) cabecalhos[k] = v;
      const resposta = await enviar({ url, corpo: init.body, cabecalhos }, init.signal);
      return { status: resposta.status, text: async () => resposta.corpo };
    },

    async requisitar(p) {
      const r = await enviar({ url: p.url, corpo: p.corpo ?? '', cabecalhos: p.cabecalhos, web: true, metodo: p.metodo });
      return { status: r.status, corpo: r.corpo, cabecalhos: r.cabecalhos || {} };
    },

    async aguardarPedidos(esperaMs) {
      ultimoContato = agora();
      if (naoEntregues().length) return entregar();
      aguardando++;
      try {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(done, esperaMs);
          function done() { clearTimeout(timer); resolve(); }
          acordar.push(done);
        });
      } finally {
        aguardando--;
        ultimoContato = agora();
      }
      return entregar();
    },

    responder(id, r) {
      const p = pendentes.get(id);
      if (!p || !p.entregue) return false;
      p.resolver(r);
      return true;
    },

    situacao() {
      return { conectada: conectada(), ultimoContato: ultimoContato != null ? new Date(ultimoContato) : null };
    },
  };
}

/** A ponte do processo do CRM (uma só). */
export const ponteEscritorio = criarPonte();
