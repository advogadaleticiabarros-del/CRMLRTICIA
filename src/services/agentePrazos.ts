/**
 * Agente de prazos — Dra. Paula (18/11/2026, pedido da Jessica: "coloque um
 * dos agentes para gerir essas páginas: ler as intimações, avisar a advogada,
 * definir os prazos [...] monitorando 3 vezes ao dia"; "um agente que lê e
 * coloca o prazo como cumprido, interpretar direito o que está sendo lido").
 *
 * Cada rodada (7h40, 13h40, 19h40):
 *  1. Intimações detectadas e ainda "a confirmar":
 *     - prazo identificado pela regra (prazoIntimacao.ts) → vira prazo;
 *     - sem prazo seguro → a IA LÊ o texto e diz o que é (sentença, prazo
 *       escrito, contrarrazões...) e para quem; a DATA continua saindo do
 *       código, pela mesma regra. Se a IA não tem certeza, vai para a Dra. ler;
 *     - prazo que já venceu sem registro não vira prazo: vai para a Dra. conferir.
 *  2. Prazos pendentes: a IA lê os movimentos posteriores à intimação e diz se
 *     a nossa parte já cumpriu. Só marca "cumprido" com prova: o movimento
 *     existe, é posterior, a IA diz que foi a nossa parte E o texto cita a
 *     advogada, a OAB ou o cliente. Sem isso, pergunta à Dra.
 *  3. Manda um WhatsApp à Dra. e à Jessica só quando há novidade.
 *
 * Nada é descartado sozinho. Banco, IA e WhatsApp entram por `deps`
 * (adaptador em agentePrazosMysql.ts).
 */
import { analisarPrazoIntimacao, type AnalisePrazo } from './prazoIntimacao';

// ── Interpretação da IA (só escolhe; não calcula) ───────────────────────────

export const TIPOS_INTERPRETACAO = ['sentenca', 'acordao', 'contrarrazoes', 'embargos_outra_parte', 'replica', 'laudo',
  'prazo_escrito', 'citacao', 'sem_prazo', 'incerto'] as const;
export type TipoInterpretacao = typeof TIPOS_INTERPRETACAO[number];
export type Destinatario = 'nosso_cliente' | 'outra_parte' | 'ambos' | 'incerto';

export interface Interpretacao { tipo: TipoInterpretacao; destinatario: Destinatario; dias: number | null; corridos: boolean; resumo: string }

function lerJson(texto: string | null | undefined): any {
  const t = String(texto || '');
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export function parseInterpretacao(texto: string | null | undefined): Interpretacao | null {
  const j = lerJson(texto);
  if (!j || typeof j !== 'object') return null;
  let tipo: TipoInterpretacao = (TIPOS_INTERPRETACAO as readonly string[]).includes(j.tipo) ? j.tipo : 'incerto';
  const destinatario: Destinatario = ['nosso_cliente', 'outra_parte', 'ambos', 'incerto'].includes(j.destinatario) ? j.destinatario : 'incerto';
  let dias: number | null = null;
  if (tipo === 'prazo_escrito') {
    const n = Number(j.dias);
    if (Number.isInteger(n) && n >= 1 && n <= 90) dias = n; else tipo = 'incerto';
  }
  return { tipo, destinatario, dias, corridos: tipo === 'prazo_escrito' && j.corridos === true, resumo: String(j.resumo || '').replace(/\s+/g, ' ').trim().slice(0, 300) };
}

/** Texto padrão de cada tipo: passa pela MESMA regra de prazo do resto do CRM. */
function textoPadrao(i: Interpretacao): { tipo: string; texto: string } | null {
  switch (i.tipo) {
    case 'sentenca': return { tipo: 'Sentença', texto: 'Sentença. Julgo procedente o pedido.' };
    case 'acordao': return { tipo: 'Acórdão', texto: 'Acórdão. Acordam os julgadores.' };
    case 'contrarrazoes': return { tipo: 'Intimação', texto: 'Intime-se para apresentar contrarrazões.' };
    case 'embargos_outra_parte': return { tipo: 'Intimação', texto: 'Embargos de declaração opostos. Intime-se para manifestação.' };
    case 'replica': return { tipo: 'Intimação', texto: 'Intime-se para réplica.' };
    case 'laudo': return { tipo: 'Intimação', texto: 'Intimem-se para manifestação sobre o laudo pericial.' };
    case 'prazo_escrito': return i.dias ? { tipo: 'Intimação', texto: `Cumpra-se no prazo de ${i.dias} dias${i.corridos ? ' corridos' : ''}.` } : null;
    case 'citacao': return { tipo: 'Citação', texto: 'Cite-se.' };
    default: return null;
  }
}

export interface EntradaProcesso { numeroProcesso: string | null; disponibilizacao: string; tribunal?: string | null; orgao?: string | null; classe?: string | null }

/** Análise do prazo a partir da leitura da IA. null = não define (outra parte, sem prazo ou incerto). */
export function analisarComInterpretacao(e: EntradaProcesso, i: Interpretacao): AnalisePrazo | null {
  if (i.destinatario === 'outra_parte' || i.destinatario === 'incerto') return null;
  const p = textoPadrao(i);
  if (!p) return null;
  return analisarPrazoIntimacao({ ...e, tipo: p.tipo, texto: p.texto });
}

// ── Cumprimento ─────────────────────────────────────────────────────────────

export interface Julgamento { cumprido: 'sim' | 'nao' | 'incerto'; movimento_id: number | null; quem: 'nosso_cliente' | 'outra_parte' | 'incerto'; motivo: string }
export interface MovimentoPosterior { id: number; data: string; titulo: string; texto: string }

export function parseJulgamento(texto: string | null | undefined): Julgamento | null {
  const j = lerJson(texto);
  if (!j || typeof j !== 'object') return null;
  return {
    cumprido: ['sim', 'nao', 'incerto'].includes(j.cumprido) ? j.cumprido : 'incerto',
    movimento_id: Number.isInteger(Number(j.movimento_id)) && j.movimento_id != null ? Number(j.movimento_id) : null,
    quem: ['nosso_cliente', 'outra_parte', 'incerto'].includes(j.quem) ? j.quem : 'incerto',
    motivo: String(j.motivo || '').replace(/\s+/g, ' ').trim().slice(0, 300),
  };
}

const norm = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ');

/**
 * `juntadasPelaDra` (desde 28/11/2026): dias (AAAA-MM-DD) em que o tribunal
 * registrou documento juntado com o CPF do login da Dra. (mni_documentos). No
 * PJe o movimento vem só como "Petição", sem citar ninguém: a juntada pela
 * Dra. no mesmo dia do movimento é a prova de que foi a nossa parte.
 */
export function avaliarCumprimento(
  j: Julgamento | null, movs: MovimentoPosterior[],
  ctx: { cliente: string | null; desde: string; termos: string[]; juntadasPelaDra?: string[] },
): { resultado: 'cumprido' | 'provavel' | 'nao'; movimentoId: number | null; motivo: string } {
  const nao = { resultado: 'nao' as const, movimentoId: null, motivo: '' };
  if (!j || j.cumprido === 'nao') return nao;
  const mov = j.movimento_id != null ? movs.find((m) => m.id === j.movimento_id) : undefined;
  if (j.movimento_id != null && !mov) return nao; // movimento que não existe: a IA inventou
  if (mov && mov.data.slice(0, 10) < ctx.desde.slice(0, 10)) return nao;
  const dia = mov?.data.slice(0, 10);
  const juntadaDaDra = !!dia && (ctx.juntadasPelaDra ?? []).includes(dia);
  const notaJuntada = juntadaDaDra && dia ? ` (petição juntada pela Dra. no tribunal em ${dia.slice(8, 10)}/${dia.slice(5, 7)})` : '';
  if (j.quem === 'outra_parte') {
    // A IA só viu "Petição": se o tribunal diz que foi a Dra. que juntou, pede confirmação.
    return juntadaDaDra && mov ? { resultado: 'provavel', movimentoId: mov.id, motivo: `${j.motivo}${notaJuntada}` } : nao;
  }
  if (!mov) return { resultado: 'provavel', movimentoId: null, motivo: j.motivo };
  const texto = norm(`${mov.titulo} ${mov.texto}`);
  const termos = [...ctx.termos, ...(ctx.cliente ? [ctx.cliente] : [])].map(norm).filter((t) => t.length >= 4);
  const citaNos = termos.some((t) => texto.includes(t));
  if (j.cumprido === 'sim' && j.quem === 'nosso_cliente' && (citaNos || juntadaDaDra)) {
    return { resultado: 'cumprido', movimentoId: mov.id, motivo: citaNos ? j.motivo : `${j.motivo}${notaJuntada}` };
  }
  return { resultado: 'provavel', movimentoId: mov.id, motivo: `${j.motivo}${notaJuntada}` };
}

// ── Rodada ──────────────────────────────────────────────────────────────────

export interface DetectadoParaAgente {
  id: number; movementId: number | null; numero: string | null; cliente: string | null; texto: string;
  disponibilizacao: string; tribunal?: string | null; orgao?: string | null; classe?: string | null; analise: AnalisePrazo | null;
}
export interface PrazoPendente {
  id: number; processId: number | null; cliente: string | null; ato: string; termo: string; desde: string;
  ultimoMovVerificado: number | null; intimacao: string; numero?: string | null;
}

export interface DepsAgentePrazos {
  hoje(): string;
  prazosAConfirmar(): Promise<DetectadoParaAgente[]>;
  interpretar(texto: string, d: DetectadoParaAgente): Promise<Interpretacao | null>;
  definirPrazo(d: DetectadoParaAgente, a: AnalisePrazo, origem: 'regra' | 'ia', nota: string): Promise<{ deadlineId: number | null }>;
  /** Marca a intimação como examinada pelo agente (não volta na próxima rodada). */
  registrarExame(id: number, nota: string): Promise<void>;
  marcarAndamentoTratado(movementId: number): Promise<void>;
  prazosPendentes(): Promise<PrazoPendente[]>;
  movimentosDepois(processId: number, desde: string, depoisDoId: number | null): Promise<MovimentoPosterior[]>;
  /** Dias (AAAA-MM-DD) com documento juntado pela Dra. no tribunal desde `desde` (mni_documentos). Opcional. */
  juntadasPelaDra?(processId: number, desde: string): Promise<string[]>;
  julgar(p: PrazoPendente, movs: MovimentoPosterior[]): Promise<Julgamento | null>;
  marcarCumprido(id: number, evidencia: string): Promise<void>;
  registrarVerificacao(id: number, ultimoMovId: number): Promise<void>;
  avisar(texto: string): Promise<boolean>;
  termosDoEscritorio?: string[];
  /** Lembrar os prazos que vencem em até 2 dias (só na rodada da manhã). */
  lembrarVencendo?: boolean;
}

const br = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '?');
const quem = (c: string | null) => c || 'sem cliente';

interface Itens {
  definidos: string[]; paraLer: string[]; vencidos: string[]; cumpridos: string[]; provaveis: string[]; vencendo: string[];
}

export function montarMensagem(i: Itens): string | null {
  const blocos: [string, string[]][] = [
    ['✅ Prazos definidos', i.definidos],
    ['☑️ Marquei como cumprido (se não foi, reabra em Prazos)', i.cumpridos],
    ['🔔 Vencem em até 2 dias', i.vencendo],
    ['❓ Parece cumprido — confirme em Prazos', i.provaveis],
    ['👀 Para a senhora ler (não deu para definir com segurança)', i.paraLer],
    ['⏰ Prazo já vencido sem registro — confira se foi cumprido', i.vencidos],
  ];
  const com = blocos.filter(([, l]) => l.length);
  if (!com.length) return null;
  return [
    '⚖️ *Dra. Paula — prazos*',
    ...com.map(([t, l]) => `\n*${t}* (${l.length})\n${l.slice(0, 15).map((x) => `• ${x}`).join('\n')}${l.length > 15 ? `\n• … e mais ${l.length - 15} em Prazos` : ''}`),
    '\nDatas contadas pelo CRM (CPC, CLT, Lei 9.099; feriado municipal não entra). A IA só lê o texto, não calcula a data.',
  ].join('\n');
}

export async function rodarAgentePrazos(deps: DepsAgentePrazos) {
  const hoje = deps.hoje();
  const it: Itens = { definidos: [], paraLer: [], vencidos: [], cumpridos: [], provaveis: [], vencendo: [] };
  const r = { examinados: 0, definidos: 0, definidosPelaIa: 0, paraLer: 0, vencidosSemRegistro: 0, cumpridos: 0, provaveis: 0, iaFalhou: 0, aviso: false };

  // 1) Intimações a confirmar
  for (const d of await deps.prazosAConfirmar()) {
    r.examinados++;
    const proc = d.numero ? ` — proc. ${d.numero}` : '';
    let analise = d.analise ?? analisarPrazoIntimacao({ numeroProcesso: d.numero, tribunal: d.tribunal, orgao: d.orgao, classe: d.classe, tipo: null, texto: d.texto, disponibilizacao: d.disponibilizacao });
    let origem: 'regra' | 'ia' = 'regra';
    let leitura = '';
    if (analise.categoria === 'revisao') {
      const i = await deps.interpretar(d.texto, d).catch(() => null);
      if (!i) r.iaFalhou++;
      const pelaIa = i ? analisarComInterpretacao({ numeroProcesso: d.numero, disponibilizacao: d.disponibilizacao, tribunal: d.tribunal, orgao: d.orgao, classe: d.classe }, i) : null;
      leitura = i?.resumo || '';
      if (pelaIa && pelaIa.categoria === 'prazo') { analise = pelaIa; origem = 'ia'; }
    }
    if (analise.categoria === 'sem_prazo') { await deps.registrarExame(d.id, `Sem prazo para o nosso cliente: ${analise.ato}`); continue; }
    if (analise.categoria !== 'prazo' || !analise.termoFinal) {
      r.paraLer++;
      it.paraLer.push(`${quem(d.cliente)}${proc}: ${leitura || analise.ato}`);
      await deps.registrarExame(d.id, `Para a Dra. ler: ${leitura || analise.ato}`.slice(0, 600));
      continue;
    }
    if (analise.termoFinal < hoje) {
      r.vencidosSemRegistro++;
      it.vencidos.push(`${quem(d.cliente)}${proc}: ${analise.ato}, venceu ${br(analise.termoFinal)}`);
      await deps.registrarExame(d.id, `Vencido em ${analise.termoFinal} sem registro de prazo`);
      continue;
    }
    const nota = origem === 'ia' ? `Definido pela leitura da IA (conferir): ${leitura}` : 'Definido pela regra do tipo de justiça';
    const def = await deps.definirPrazo(d, analise, origem, nota);
    r.definidos++;
    if (origem === 'ia') r.definidosPelaIa++;
    if (d.movementId) await deps.marcarAndamentoTratado(d.movementId);
    it.definidos.push(`${quem(d.cliente)} — ${analise.ato}: protocolar até ${br(analise.protocolarAte)} (limite ${br(analise.termoFinal)})${proc}`
      + `${origem === 'ia' ? ' · lido pela IA, conferir' : ''}${def.deadlineId ? '' : ' · processo sem caso ligado'}`);
  }

  // 2) Prazos pendentes: já cumpridos?
  const termos = deps.termosDoEscritorio ?? [];
  const limiteLembrete = new Date(`${hoje}T12:00:00Z`); limiteLembrete.setUTCDate(limiteLembrete.getUTCDate() + 2);
  const ateLembrete = limiteLembrete.toISOString().slice(0, 10);
  for (const p of await deps.prazosPendentes()) {
    let cumpriu = false;
    if (p.processId) {
      const movs = await deps.movimentosDepois(p.processId, p.desde, p.ultimoMovVerificado);
      if (movs.length) {
        const j = await deps.julgar(p, movs).catch(() => null);
        if (!j) r.iaFalhou++;
        const juntadasPelaDra = deps.juntadasPelaDra ? await deps.juntadasPelaDra(p.processId, p.desde).catch(() => []) : [];
        const av = avaliarCumprimento(j, movs, { cliente: p.cliente, desde: p.desde, termos, juntadasPelaDra });
        const mov = movs.find((m) => m.id === av.movimentoId);
        const prova = mov ? `${mov.titulo} (${br(mov.data)})` : 'sem movimento citado';
        if (av.resultado === 'cumprido') {
          await deps.marcarCumprido(p.id, `${prova}: ${av.motivo}`.slice(0, 600));
          r.cumpridos++; cumpriu = true;
          it.cumpridos.push(`${quem(p.cliente)} — ${p.ato}: ${prova}`);
        } else if (av.resultado === 'provavel') {
          r.provaveis++;
          it.provaveis.push(`${quem(p.cliente)} — ${p.ato}: ${prova}${av.motivo ? ` — ${av.motivo}` : ''}`);
        }
        // Mesmo sem prova (e se a IA falhou), anota até onde leu só quando
        // houve julgamento, para tentar de novo na próxima rodada.
        if (j) await deps.registrarVerificacao(p.id, Math.max(...movs.map((m) => m.id)));
      }
    }
    if (!cumpriu && deps.lembrarVencendo !== false && p.termo >= hoje && p.termo <= ateLembrete) {
      it.vencendo.push(`${quem(p.cliente)} — ${p.ato}: limite ${br(p.termo)}${p.numero ? ` — proc. ${p.numero}` : ''}`);
    }
  }

  const msg = montarMensagem(it);
  if (msg) r.aviso = await deps.avisar(msg).catch(() => false);
  return r;
}
