/**
 * Mesa da Chefe: a CEO do escritório (Dra. Letícia, advogada chefe) recebe tudo o
 * que a equipe de agentes entrega e confere (13/11/2026, pedido da Jessica:
 * "a CEO que confere tudo e recebe todos os fluxos, recados, avaliações").
 *
 * Três tipos de coisa chegam à mesa dela:
 *  - **para conferir:** o que espera uma decisão dela (mensagem a aprovar,
 *    contrato a revisar, prazo a confirmar…). Só isso entra no total da mesa;
 *  - **avaliações:** o que os agentes avaliaram e ela deve conhecer (sentenças
 *    lidas, documentos com ponto grave, possíveis clientes com chance alta);
 *  - **recados e ideias:** o que cada agente fez nas últimas 24h e as ideias da
 *    reunião da equipe.
 *
 * Regras puras, testadas em tests/mesaDaChefe.test.mjs. As contagens vêm do
 * banco em src/routes/escritorio.ts (GET /api/escritorio/chefe).
 */
import { AGENTES } from './escritorioVirtual';

export type GrupoDaChefe = 'conferir' | 'avaliacoes';

export interface ItemDaChefe {
  id: string;
  grupo: GrupoDaChefe;
  titulo: string;
  /** Quem da equipe entrega este item (id do agente, ou 'equipe' quando vem de vários). */
  agente: string;
  /** Onde a tela abre: "agente:<id>", "tela:<rota>" ou "aprovar". */
  abrir: string;
  /** Frase curta do que é, com {n} no lugar do número. */
  explica: string;
}

export const ITENS_DA_CHEFE: ItemDaChefe[] = [
  { id: 'mensagens', grupo: 'conferir', titulo: 'Mensagens para aprovar', agente: 'equipe', abrir: 'aprovar', explica: 'rascunhos dos agentes esperando envio, edição ou descarte' },
  { id: 'propostas', grupo: 'conferir', titulo: 'Propostas para aprovar', agente: 'produtor', abrir: 'tela:propostas', explica: 'montadas pela Dra. Bianca pela tabela' },
  { id: 'contratos', grupo: 'conferir', titulo: 'Contratos para revisar', agente: 'fechador', abrir: 'tela:contratos', explica: 'proposta aceita, contrato pronto para revisar e mandar assinar' },
  { id: 'prazos', grupo: 'conferir', titulo: 'Prazos para confirmar', agente: 'prazos', abrir: 'tela:prazos', explica: 'encontrados nas intimações' },
  { id: 'fichas', grupo: 'conferir', titulo: 'Dados da ficha para conferir', agente: 'coletor', abrir: 'agente:coletor', explica: 'valor diferente do cadastro ou leitura incerta' },
  { id: 'erros', grupo: 'conferir', titulo: 'Erros do sistema em aberto', agente: 'guardiao', abrir: 'agente:guardiao', explica: 'avisados pelo Dr. Bento' },
  { id: 'decisoes_lidas', grupo: 'avaliacoes', titulo: 'Sentenças e acórdãos lidos (7 dias)', agente: 'leitor', abrir: 'agente:leitor', explica: 'resultado, valor e prazo de recurso' },
  { id: 'analises_graves', grupo: 'avaliacoes', titulo: 'Documentos com ponto grave (7 dias)', agente: 'analista', abrir: 'agente:analista', explica: 'divergência entre os documentos e a história contada' },
  { id: 'leads_quentes', grupo: 'avaliacoes', titulo: 'Possíveis clientes com chance alta', agente: 'copiloto', abrir: 'agente:copiloto', explica: 'qualificados em 70% ou mais pelo Dr. Otávio' },
  { id: 'vigia', grupo: 'avaliacoes', titulo: 'Avisos da carteira (7 dias)', agente: 'carteira', abrir: 'agente:carteira', explica: 'processo parado, prescrição ou fase desatualizada' },
];

const GRUPOS: Array<{ id: GrupoDaChefe; titulo: string }> = [
  { id: 'conferir', titulo: 'Para conferir' },
  { id: 'avaliacoes', titulo: 'Avaliações da equipe' },
];

export interface RecadoBruto { agente: string; texto: string; created_at: Date | string }
export interface IdeiaBruta { agente: string; ideia: string }

export interface ItemNaMesa extends ItemDaChefe { n: number; emDia: boolean; detalhe: string; nomeAgente: string }
export interface MesaDaChefe {
  total: number;
  urgentes: number;
  frase: string;
  grupos: Array<{ id: GrupoDaChefe; titulo: string; itens: ItemNaMesa[] }>;
  recados: Array<{ agente: string; nome: string; cor: string; texto: string; em: string }>;
  ideias: Array<{ agente: string; nome: string; ideia: string }>;
}

const MAX_RECADOS = 30;
const agentePorId = new Map(AGENTES.map((a) => [a.id, a]));

/**
 * Monta a mesa da CEO. `contagens` traz o número de cada item de ITENS_DA_CHEFE
 * e, à parte, `mensagens_urgentes`. Itens zerados ficam no fim, como "em dia".
 */
export function montarMesaDaChefe(entrada: {
  contagens: Record<string, number>;
  recados: RecadoBruto[];
  ideias: IdeiaBruta[];
  agora: Date;
}): MesaDaChefe {
  const c = entrada.contagens;
  const urgentes = Math.max(0, Number(c.mensagens_urgentes) || 0);
  const itens: ItemNaMesa[] = ITENS_DA_CHEFE.map((i, ordem) => {
    const n = Math.max(0, Number(c[i.id]) || 0);
    const extra = i.id === 'mensagens' && urgentes ? ` · ${urgentes} urgente${urgentes > 1 ? 's' : ''}` : '';
    return { ...i, n, emDia: n === 0, detalhe: i.explica + extra, nomeAgente: agentePorId.get(i.agente)?.nome || (i.agente === 'equipe' ? 'toda a equipe' : i.agente), ordem } as ItemNaMesa & { ordem: number };
  });
  const grupos = GRUPOS.map((g) => ({
    ...g,
    itens: itens.filter((i) => i.grupo === g.id)
      // Com número primeiro (na ordem de importância da lista), zerados no fim.
      .sort((a: any, b: any) => (Number(a.emDia) - Number(b.emDia)) || (a.ordem - b.ordem))
      .map(({ ordem: _o, ...resto }: any) => resto as ItemNaMesa),
  }));
  const total = itens.filter((i) => i.grupo === 'conferir').reduce((s, i) => s + i.n, 0);
  const frase = total === 0 ? 'Tudo em dia: nada esperando a sua conferência.'
    : `${total} ${total === 1 ? 'item' : 'itens'} esperando a sua conferência${urgentes ? ` (${urgentes} urgente${urgentes > 1 ? 's' : ''})` : ''}.`;

  const recados = entrada.recados
    .map((r) => {
      const a = agentePorId.get(r.agente);
      return { agente: r.agente, nome: a?.nome || r.agente, cor: a?.cor || '#64748b', texto: String(r.texto || ''), em: new Date(r.created_at).toISOString() };
    })
    .sort((x, y) => y.em.localeCompare(x.em))
    .slice(0, MAX_RECADOS);
  const ideias = entrada.ideias
    .filter((i) => i && i.ideia)
    .map((i) => ({ agente: i.agente, nome: agentePorId.get(i.agente)?.nome || i.agente, ideia: String(i.ideia) }));

  return { total, urgentes, frase, grupos, recados, ideias };
}
