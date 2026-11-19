/**
 * Tela da TV do escritório (19/11/2026, pedido da Jessica: "monitorar tudo
 * através de uma TV no escritório [...] monitoramento de mensagens do WhatsApp").
 *
 * A TV fica à vista de quem entra no escritório, inclusive clientes. Por isso o
 * resumo do WhatsApp nasce em **modo discreto**: só o primeiro nome e a inicial,
 * sem o texto das mensagens. O telefone nunca sai daqui, em nenhum modo.
 * Regras puras; a consulta ao banco fica em routes/tv.ts.
 */

export interface ConversaBruta {
  phone: string;
  nome: string | null;
  ultimaEm: Date | string;
  ultimaDeMim: boolean;
  naoLidas: number;
  previa: string | null;
  arquivada: boolean;
}

export interface EntradaWhatsapp {
  conectado: boolean | null;
  ultimaRecebidaEm: Date | string | null;
  recebidasHoje: number;
  enviadasHoje: number;
  rascunhosPendentes: number;
  conversas: ConversaBruta[];
}

export interface ConversaNaTv { nome: string; esperaMin: number; naoLidas: number; previa: string | null }
export interface RecenteNaTv { nome: string; em: string; deMim: boolean; previa: string | null }

export interface ResumoWhatsapp {
  conectado: boolean | null;
  alerta: string | null;
  recebidasHoje: number;
  enviadasHoje: number;
  rascunhosPendentes: number;
  totalAguardando: number;
  maiorEsperaMin: number;
  aguardando: ConversaNaTv[];
  recentes: RecenteNaTv[];
}

const JANELA_AGUARDANDO_MIN = 72 * 60;
const MAX_AGUARDANDO = 12;
const MAX_RECENTES = 8;
const TAM_PREVIA = 90;
const SILENCIO_ALERTA_MIN = 6 * 60;

const ms = (d: Date | string) => new Date(d).getTime();
const maiuscula = (p: string) => p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1).toLocaleLowerCase('pt-BR');

/** "Maria da Silva Souza" → "Maria S.". Sem nome (ou só número) → "Contato". */
export function nomeDiscreto(nome: string | null): string {
  const partes = String(nome || '').trim().split(/\s+/).filter((p) => p && !/^\d+$/.test(p));
  if (!partes.length) return 'Contato';
  const primeiro = maiuscula(partes[0]);
  if (partes.length === 1) return primeiro;
  return `${primeiro} ${partes[partes.length - 1].charAt(0).toLocaleUpperCase('pt-BR')}.`;
}

function previaCurta(texto: string | null): string | null {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > TAM_PREVIA ? `${t.slice(0, TAM_PREVIA)}…` : t;
}

/** Horário comercial em Brasília (seg a sex, 8h às 19h): silêncio longo aí é suspeito. */
function horarioComercial(agora: Date): boolean {
  const br = new Date(agora.getTime() - 3 * 3600000);
  const dia = br.getUTCDay();
  const hora = br.getUTCHours();
  return dia >= 1 && dia <= 5 && hora >= 8 && hora < 19;
}

export function resumirWhatsapp(e: EntradaWhatsapp, agora: Date, opcoes: { discreto: boolean }): ResumoWhatsapp {
  const t = agora.getTime();
  const nomeDe = (c: ConversaBruta) => (opcoes.discreto ? nomeDiscreto(c.nome) : (String(c.nome || '').trim() || 'Contato'));
  const previaDe = (c: ConversaBruta) => (opcoes.discreto ? null : previaCurta(c.previa));
  const ativas = e.conversas.filter((c) => !c.arquivada);

  const esperando = ativas
    .filter((c) => !c.ultimaDeMim && t - ms(c.ultimaEm) <= JANELA_AGUARDANDO_MIN * 60000)
    .map((c) => ({ c, esperaMin: Math.max(0, Math.round((t - ms(c.ultimaEm)) / 60000)) }))
    .sort((a, b) => b.esperaMin - a.esperaMin);

  const recentes = [...ativas]
    .sort((a, b) => ms(b.ultimaEm) - ms(a.ultimaEm))
    .slice(0, MAX_RECENTES)
    .map((c) => ({ nome: nomeDe(c), em: new Date(c.ultimaEm).toISOString(), deMim: !!c.ultimaDeMim, previa: previaDe(c) }));

  let alerta: string | null = null;
  if (e.conectado === false) alerta = 'O WhatsApp do escritório está desconectado';
  else if (e.ultimaRecebidaEm && horarioComercial(agora)) {
    const silencio = Math.round((t - ms(e.ultimaRecebidaEm)) / 60000);
    if (silencio > SILENCIO_ALERTA_MIN) alerta = `Nenhuma mensagem recebida há ${Math.floor(silencio / 60)}h — confira a conexão`;
  }

  return {
    conectado: e.conectado,
    alerta,
    recebidasHoje: Number(e.recebidasHoje) || 0,
    enviadasHoje: Number(e.enviadasHoje) || 0,
    rascunhosPendentes: Number(e.rascunhosPendentes) || 0,
    totalAguardando: esperando.length,
    maiorEsperaMin: esperando.length ? esperando[0].esperaMin : 0,
    aguardando: esperando.slice(0, MAX_AGUARDANDO).map(({ c, esperaMin }) => ({ nome: nomeDe(c), esperaMin, naoLidas: Number(c.naoLidas) || 0, previa: previaDe(c) })),
    recentes,
  };
}

// ── Avisos com som (19/11/2026, Jessica: "efeitos sonoros para coisas de
// atenção, a cada novo processo protocolado, conversas que precisam de
// atenção, algum agente chamando etc.") ─────────────────────────────────────
// A TV pergunta "o que aconteceu desde a última vez?" a cada 30s; aqui vira
// uma lista curta de avisos, já agrupados para não fazer barulho demais.
// Sempre com nome discreto: o aviso aparece grande na tela.

export type TipoAviso = 'urgente' | 'audiencia' | 'erro' | 'protocolo' | 'conversa' | 'aprovacao' | 'prazo';
export type SomAviso = 'festa' | 'chamado' | 'ping' | 'alerta';
export interface Aviso { tipo: TipoAviso; som: SomAviso; icone: string; titulo: string; texto: string }

export interface EntradaAvisos {
  protocolados: { nome: string | null; area: string | null }[];
  conversasEsperando: { nome: string | null }[];
  rascunhos: { agente: string | null; nome: string | null; urgente: boolean }[];
  prazosNovos: number;
  errosRotina: { job: string }[];
  audiencias: { inicio: Date | string }[];
}

const ORDEM_AVISO: TipoAviso[] = ['urgente', 'audiencia', 'erro', 'protocolo', 'conversa', 'aprovacao', 'prazo'];
const MAX_POR_TIPO = 3;
const areaLegivel = (a: string | null) => {
  const t = String(a || '').replace(/_/g, ' ').trim();
  return t ? maiuscula(t) : '';
};

export function montarAvisos(
  e: EntradaAvisos,
  nomesAgentes: Record<string, string>,
  agenteDaRotina: (job: string) => string | null = () => null,
): Aviso[] {
  const avisos: Aviso[] = [];
  const nomeAgente = (id: string | null) => (id && nomesAgentes[id]) || 'Um agente';

  e.rascunhos.filter((r) => r.urgente).slice(0, MAX_POR_TIPO).forEach((r) => avisos.push({
    tipo: 'urgente', som: 'chamado', icone: '🔔', titulo: 'Mensagem urgente para aprovar',
    texto: `${nomeAgente(r.agente)} chama: ${nomeDiscreto(r.nome)} precisa de resposta`,
  }));

  e.audiencias.slice(0, MAX_POR_TIPO).forEach((a) => avisos.push({
    tipo: 'audiencia', som: 'chamado', icone: '⚖️',
    titulo: `Audiência às ${new Date(a.inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}`,
    texto: 'Começa em 30 minutos',
  }));

  const errosPorAgente = new Map<string, number>();
  let errosSemDono = 0;
  e.errosRotina.forEach((r) => {
    const dono = agenteDaRotina(r.job);
    if (dono) errosPorAgente.set(dono, (errosPorAgente.get(dono) || 0) + 1); else errosSemDono++;
  });
  [...errosPorAgente.keys()].slice(0, MAX_POR_TIPO).forEach((id) => avisos.push({
    tipo: 'erro', som: 'alerta', icone: '⚠️', titulo: `${nomeAgente(id)} está com erro`, texto: 'Uma rotina dele falhou agora. Veja no Escritório virtual.',
  }));
  if (errosSemDono) avisos.push({ tipo: 'erro', som: 'alerta', icone: '⚠️', titulo: 'Uma rotina do sistema deu erro', texto: 'Veja no Escritório virtual.' });

  e.protocolados.slice(0, MAX_POR_TIPO).forEach((p) => avisos.push({
    tipo: 'protocolo', som: 'festa', icone: '🎉', titulo: 'Processo protocolado!',
    texto: [areaLegivel(p.area), nomeDiscreto(p.nome)].filter(Boolean).join(' · '),
  }));

  const conversas = e.conversasEsperando.length;
  if (conversas) avisos.push({
    tipo: 'conversa', som: 'ping', icone: '💬',
    titulo: conversas === 1 ? `${nomeDiscreto(e.conversasEsperando[0].nome)} espera resposta há 30 min` : `${conversas} conversas esperando resposta há 30 min`,
    texto: 'No WhatsApp do escritório',
  });

  const comuns = new Map<string, number>();
  e.rascunhos.filter((r) => !r.urgente).forEach((r) => comuns.set(r.agente || '', (comuns.get(r.agente || '') || 0) + 1));
  [...comuns.entries()].slice(0, MAX_POR_TIPO).forEach(([id, n]) => avisos.push({
    tipo: 'aprovacao', som: 'chamado', icone: '✋',
    titulo: `${nomeAgente(id || null)} pede aprovação de ${n === 1 ? '1 mensagem' : `${n} mensagens`}`,
    texto: 'Em Escritório virtual → Mensagens para aprovar',
  }));

  const prazos = Number(e.prazosNovos) || 0;
  if (prazos) avisos.push({
    tipo: 'prazo', som: 'chamado', icone: '📅',
    titulo: `${nomeAgente('prazos')}: ${prazos === 1 ? '1 prazo novo' : `${prazos} prazos novos`} para conferir`,
    texto: 'Em Prazos a confirmar',
  });

  return avisos.sort((a, b) => ORDEM_AVISO.indexOf(a.tipo) - ORDEM_AVISO.indexOf(b.tipo));
}
