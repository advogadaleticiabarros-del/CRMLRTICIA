/**
 * Leitor de sentença/acórdão (escritório virtual, agente "Leitor de decisões").
 *
 * Quando chega a ÍNTEGRA de uma sentença ou acórdão (DJEN), a IA lê o texto e
 * devolve, em formato fixo (JSON validado aqui): resultado para o cliente, o
 * que ganhamos e perdemos, valor, sucumbência, justiça gratuita e pontos de
 * atenção. O recurso cabível e o prazo NÃO vêm da IA: saem de uma tabela fixa
 * (CLT, Juizados, CPC) e da contagem em dias úteis de `utils/prazoUtil`.
 * A Secretária particular (`secretariaParticular.ts`) monta a mensagem e ela
 * vai para a Dra. no WhatsApp.
 *
 * Interface única: `lerDecisaoEAvisar(entrada, deps)`. IA, banco e envio são
 * injetados — testado em tests/leitorDecisao.test.mjs.
 */
import crypto from 'crypto';
import { contarPrazo } from '../utils/prazoUtil';
import { montarMensagemDecisao } from './secretariaParticular';

export type Justica = 'trabalho' | 'federal' | 'estadual' | 'outra';
export type TipoDecisao = 'sentenca' | 'acordao';

/** Abaixo disso é só o nome do andamento (DataJud), não a decisão. */
export const TEXTO_MINIMO_LEITURA = 400;
/** Limite de texto mandado à IA (sentenças longas). */
const TEXTO_MAXIMO_IA = 30000;

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Segmento "J" do número CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO): 4 federal, 5 trabalho, 8 estadual. */
export function justicaDoNumero(numero: string): Justica {
  const d = String(numero || '').replace(/\D/g, '');
  if (d.length !== 20) return 'outra';
  const j = d[13];
  if (j === '5') return 'trabalho';
  if (j === '4') return 'federal';
  if (j === '8') return 'estadual';
  return 'outra';
}

const JUIZADO_RE = /juizado especial|\bjef\b|\bjec\b|turma recursal|lei\s*(?:n[ºo°.]*\s*)?9\.?099|lei\s*(?:n[ºo°.]*\s*)?10\.?259|lei\s*(?:n[ºo°.]*\s*)?12\.?153/;

/** Juizado Especial (rito da Lei 9.099/10.259/12.153), pelo órgão ou pelo texto da decisão. */
export function ehJuizado(orgao: string | null | undefined, texto: string | null | undefined): boolean {
  return JUIZADO_RE.test(semAcento(`${orgao || ''} ${texto || ''}`));
}

export interface RecursoCabivel { nome: string; dias: number }

/**
 * Recursos cabíveis contra a decisão, com o prazo em dias úteis. Os embargos
 * de declaração (5 dias em todos os ritos) vêm primeiro por serem o prazo
 * mais curto. Regra fixa, não depende da IA.
 */
export function recursosCabiveis(o: { justica: Justica; juizado: boolean; tipo: TipoDecisao }): RecursoCabivel[] {
  const ed: RecursoCabivel = { nome: 'Embargos de declaração', dias: 5 };
  if (o.justica === 'trabalho') {
    return [ed, o.tipo === 'sentenca' ? { nome: 'Recurso ordinário', dias: 8 } : { nome: 'Recurso de revista', dias: 8 }];
  }
  if (o.juizado) {
    if (o.tipo === 'sentenca') return [ed, { nome: 'Recurso inominado', dias: 10 }];
    return [ed, o.justica === 'federal'
      ? { nome: 'Pedido de uniformização (TNU)', dias: 15 }
      : { nome: 'Recurso extraordinário', dias: 15 }];
  }
  return [ed, o.tipo === 'sentenca' ? { nome: 'Apelação', dias: 15 } : { nome: 'Recurso especial / extraordinário', dias: 15 }];
}

// ── Leitura pela IA, em formato fixo ─────────────────────────────────────────

export const RESULTADOS = [
  'procedente', 'parcialmente_procedente', 'improcedente', 'extinto_sem_merito', 'acordo_homologado',
  'provido', 'parcialmente_provido', 'nao_provido', 'nao_conhecido', 'outro',
] as const;
export type Resultado = typeof RESULTADOS[number];
export type Favoravel = 'sim' | 'parcial' | 'nao' | 'indefinido';

export interface LeituraDecisao {
  tipo: TipoDecisao;
  resultado: Resultado;
  favoravel_ao_cliente: Favoravel;
  resumo: string;
  ganhamos: string[];
  perdemos: string[];
  valor_condenacao: number | null;
  valor_texto: string;
  honorarios_sucumbencia: string;
  justica_gratuita: 'deferida' | 'indeferida' | null;
  pontos_de_atencao: string[];
  sugestao: string;
}

export function promptLeitorDecisao(cliente: string | null, texto: string): string {
  const quem = cliente
    ? `O escritório representa ${cliente}. "ganhamos"/"perdemos" e "favoravel_ao_cliente" são do ponto de vista dessa parte.`
    : 'A parte representada pelo escritório não foi identificada: use "favoravel_ao_cliente": "indefinido" e descreva ganhos/perdas pelo polo (autor/réu).';
  return `Você é advogado(a) sênior lendo uma decisão judicial para resumir à advogada responsável. ${quem}
Responda SOMENTE com um objeto JSON, sem texto fora dele, com estas chaves:
{"tipo": "sentenca" | "acordao",
 "resultado": ${RESULTADOS.map((r) => `"${r}"`).join(' | ')},
 "favoravel_ao_cliente": "sim" | "parcial" | "nao" | "indefinido",
 "resumo": "2-3 linhas em linguagem simples",
 "ganhamos": ["pedido deferido", ...],
 "perdemos": ["pedido negado", ...],
 "valor_condenacao": "R$ 0,00" ou null se não houver valor no texto,
 "valor_texto": "como o valor aparece (ex.: provisório, a apurar em liquidação)",
 "honorarios_sucumbencia": "percentual e base, ou \\"não fixados\\"",
 "justica_gratuita": "deferida" | "indeferida" | null,
 "pontos_de_atencao": ["omissão, contradição, erro material, pedido não analisado, tutela, multa", ...],
 "sugestao": "próximo passo sugerido, em 1 linha"}
Use SOMENTE o que está no texto. Não invente valor, pedido nem fundamento.

DECISÃO:
${texto.slice(0, TEXTO_MAXIMO_IA)}`;
}

function lista(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 12) : [];
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** "R$ 12.345,67" | 12345.67 | "12345.67" → número; senão null. */
function valorEmNumero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
  const s = String(v ?? '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function normResultado(v: unknown): Resultado {
  const s = semAcento(String(v ?? '')).replace(/[\s-]+/g, '_');
  return (RESULTADOS as readonly string[]).includes(s) ? (s as Resultado) : 'outro';
}

function normFavoravel(v: unknown): Favoravel {
  const s = semAcento(String(v ?? ''));
  return s === 'sim' || s === 'parcial' || s === 'nao' ? s : 'indefinido';
}

/** Valida a resposta JSON da IA. null = formato inválido ou sem resumo. */
export function parseLeituraDecisao(resposta: string): LeituraDecisao | null {
  const limpo = String(resposta || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!limpo.startsWith('{')) return null;
  let o: any;
  try { o = JSON.parse(limpo); } catch { return null; }
  const resumo = texto(o?.resumo);
  if (!resumo) return null;
  const jg = semAcento(String(o.justica_gratuita ?? ''));
  return {
    tipo: semAcento(String(o.tipo ?? '')).startsWith('acord') ? 'acordao' : 'sentenca',
    resultado: normResultado(o.resultado),
    favoravel_ao_cliente: normFavoravel(o.favoravel_ao_cliente),
    resumo,
    ganhamos: lista(o.ganhamos),
    perdemos: lista(o.perdemos),
    valor_condenacao: valorEmNumero(o.valor_condenacao),
    valor_texto: texto(o.valor_texto),
    honorarios_sucumbencia: texto(o.honorarios_sucumbencia),
    justica_gratuita: jg === 'deferida' || jg === 'indeferida' ? jg : null,
    pontos_de_atencao: lista(o.pontos_de_atencao),
    sugestao: texto(o.sugestao),
  };
}

// ── Orquestração ─────────────────────────────────────────────────────────────

export interface EntradaDecisao {
  processId: number;
  processo: string;
  cliente: string | null;
  orgao: string | null;
  tipo: TipoDecisao;
  texto: string;
  /** Data da publicação (AAAA-MM-DD); sem ela, usa hoje. */
  publicadaEm: string | null;
}

export interface DepsLeitor {
  /** Resposta crua da IA ao prompt, ou null se a IA estiver indisponível. */
  ia(prompt: string): Promise<string | null>;
  /** Grava a leitura. true = gravou agora; false = esta decisão já tinha sido lida. */
  registrar(chave: string, leitura: LeituraDecisao, entrada: EntradaDecisao): Promise<boolean>;
  enviar(texto: string): Promise<void>;
  hojeISO(): string;
}

export type ResultadoLeitura = 'enviado' | 'sem_texto' | 'ia_falhou' | 'ja_lido';

/** Mesma decisão republicada (ou com espaçamento diferente) gera a mesma chave. */
export function chaveLeitura(e: Pick<EntradaDecisao, 'processId' | 'tipo' | 'texto'>): string {
  const normal = semAcento(e.texto).replace(/\s+/g, ' ').slice(0, 2000);
  return crypto.createHash('sha256').update(`${e.processId}|${e.tipo}|${normal}`).digest('hex');
}

export async function lerDecisaoEAvisar(e: EntradaDecisao, deps: DepsLeitor): Promise<ResultadoLeitura> {
  const teor = String(e.texto || '').trim();
  if (teor.length < TEXTO_MINIMO_LEITURA) return 'sem_texto';

  const resposta = await deps.ia(promptLeitorDecisao(e.cliente, teor));
  const leitura = resposta ? parseLeituraDecisao(resposta) : null;
  if (!leitura) return 'ia_falhou';

  if (!(await deps.registrar(chaveLeitura(e), leitura, e))) return 'ja_lido';

  const inicio = e.publicadaEm || deps.hojeISO();
  const recursos = recursosCabiveis({
    justica: justicaDoNumero(e.processo),
    juizado: ehJuizado(e.orgao, teor),
    // A IA leu a decisão inteira; o gatilho só viu a palavra "sentença"/"acórdão"
    // (uma sentença que cita um acórdão enganaria o gatilho).
    tipo: leitura.tipo,
  });
  const prazos = recursos.map((r) => ({ ...r, vencimento: contarPrazo(inicio, r.dias).vencimento }));

  await deps.enviar(montarMensagemDecisao({
    leitura, processo: e.processo, cliente: e.cliente, orgao: e.orgao, prazos, publicadaEm: inicio,
  }));
  return 'enviado';
}
