import type { Acervo } from './leisAcervo';
import {
  extrairCitacoes, interpretarPergunta, blocoFundamentos, relatorioConferencia, trechoRelevante, ROTULO_SITUACAO,
  type Fundamento, type ResultadoConferencia,
} from './leisTexto';

/** Começo de mensagem que é pedido de lei (o resto do assistente nunca começa assim). */
const PEDIDO_DE_LEI = /^(?:leis?|arts?\.?|artigos?|s[uú]mulas?|oj|orienta[cç][aã]o jurisprudencial|tema|cf|clt|cpc|cdc|ctn|eca|adct|rps|loas|lindb|constitui[cç][aã]o)(?![a-zà-ú])/i;

/**
 * Os dois agentes que usam o acervo de leis:
 *  - Dra. Júlia (pesquisador): antes de redigir, separa os dispositivos que
 *    EXISTEM no acervo — os citados no próprio caso/intimação, os que a IA
 *    sugere (cada um conferido no índice; o que não existe é descartado) e as
 *    súmulas/temas achados pela busca com os termos do caso;
 *  - Dra. Vera (verificadora): depois de redigir, confere cada citação da peça
 *    (existe? está em vigor? o artigo é desse diploma?) e pede à IA, com o
 *    texto oficial ao lado, se ele sustenta o que a peça afirma.
 * IA, acervo e registro de ação entram por dependência (testes com simulação).
 */

export type Ia = (prompt: string) => Promise<{ ok: boolean; text?: string; message?: string }>;

export interface DepsPesquisa {
  acervo: Acervo | null;
  ia: Ia;
  registrar: (agente: string, texto: string) => void;
}

export interface ContextoPeca { area?: string | null; tipo?: string | null }

export type ItemConferido = ResultadoConferencia & { normaId?: number };

/** Tira o JSON de uma resposta de IA (com ou sem cerca ```json, com texto em volta). */
export function lerJsonDaIa(texto: string): any {
  const t = String(texto || '').replace(/```(?:json)?/gi, '');
  const ini = t.search(/[[{]/);
  if (ini < 0) return null;
  const abre = t[ini], fecha = abre === '{' ? '}' : ']';
  const fim = t.lastIndexOf(fecha);
  if (fim <= ini) return null;
  try { return JSON.parse(t.slice(ini, fim + 1)); } catch { return null; }
}

const promptSugestao = (texto: string, ctx: ContextoPeca) => `Você é pesquisador(a) jurídico(a) de um escritório de advocacia brasileiro (trabalhista, previdenciário, família e consumidor).
Peça a redigir: ${ctx.tipo || 'peça processual'}${ctx.area ? ` · área: ${ctx.area}` : ''}.
Leia o caso abaixo e liste os dispositivos legais e a jurisprudência vinculante/consolidada que fundamentam a peça.
Responda APENAS com JSON, sem comentários, no formato:
{"dispositivos": ["art. 477 da CLT", "art. 42 da Lei 8.213/1991", "Súmula 331 do TST", "Tema 1046 do STF"], "termos": ["expressão curta para buscar súmulas"]}
Regras: no máximo 10 dispositivos e 3 termos; cite pelo número (artigo + lei/código, súmula + tribunal, OJ + órgão, tema + tribunal); não invente — na dúvida, deixe de fora (tudo será conferido no texto oficial).

CASO:
${texto.slice(0, 3500)}`;

function contextoDaCitacao(texto: string, trecho: string): string {
  const i = texto.indexOf(trecho);
  if (i < 0) return trecho;
  return texto.slice(Math.max(0, i - 350), Math.min(texto.length, i + trecho.length + 250)).replace(/\s+/g, ' ').trim();
}

export function criarPesquisa(deps: DepsPesquisa) {
  const { acervo, ia, registrar } = deps;

  async function pesquisarFundamentos(texto: string, ctx: ContextoPeca = {}, limite = 14): Promise<Fundamento[]> {
    if (!acervo) return [];
    const doTexto = acervo.fundamentos(extrairCitacoes(texto).map((c) => c.trecho));
    let sugeridos: Fundamento[] = [];
    const daBusca: Fundamento[] = [];
    try {
      const r = await ia(promptSugestao(texto, ctx));
      const j = r.ok ? lerJsonDaIa(r.text || '') : null;
      const dispositivos: string[] = Array.isArray(j?.dispositivos) ? j.dispositivos.map(String).slice(0, 12) : [];
      const termos: string[] = Array.isArray(j?.termos) ? j.termos.map(String).slice(0, 3) : [];
      sugeridos = acervo.fundamentos(dispositivos);
      for (const termo of termos) {
        for (const achado of acervo.buscar(termo, { esferas: ['jurisprudencia'], vigentes: true }, 2)) {
          const d = acervo.dispositivo(achado.dispositivoId);
          if (d && daBusca.length < 4) daBusca.push({ citacao: d.titulo, texto: d.texto, fonte: d.fonte });
        }
      }
    } catch { /* sem IA: fica com o que o texto já cita */ }
    const vistos = new Set<string>();
    return [...doTexto, ...sugeridos, ...daBusca].filter((f) => (vistos.has(f.citacao) ? false : (vistos.add(f.citacao), true))).slice(0, limite);
  }

  /**
   * Pedido de lei pelo WhatsApp ("art 482 clt", "súmula 331 tst", "lei 8213 art 42"):
   * texto oficial na hora, sem IA. null = não é pedido de lei (segue o assistente).
   */
  function consultaRapida(texto: string): string | null {
    const t = String(texto || '').trim();
    if (!acervo || t.length > 200 || !PEDIDO_DE_LEI.test(t)) return null;
    const cits = interpretarPergunta(t.replace(/^leis?\s+/i, ''));
    if (!cits.length) return null;
    const partes: string[] = [];
    for (const c of cits.slice(0, 3)) {
      for (const r of acervo.conferir(c.trecho).slice(0, 1)) {
        if (r.situacao === 'fora_do_acervo' || r.situacao === 'artigo_inexistente') {
          partes.push(`Não achei "${r.trecho}" no acervo de leis (${ROTULO_SITUACAO[r.situacao]}).`);
          continue;
        }
        const corpo = String(r.texto || '').trim();
        const aviso = r.situacao === 'confere' ? '' : `⚠️ ${ROTULO_SITUACAO[r.situacao]}\n`;
        partes.push(`📖 *${r.citacao || r.trecho}*\n${aviso}${corpo.length > 1500 ? corpo.slice(0, 1500) + '…' : corpo}${r.fonte ? `\nFonte: ${r.fonte}` : ''}`);
      }
    }
    if (!partes.length) return null;
    registrar('pesquisador', `respondeu no WhatsApp: ${cits.map((c) => c.trecho).join('; ').slice(0, 120)}`);
    return `${partes.join('\n\n')}\n\n_Texto do acervo público de leis. Antes de protocolar, confira na fonte._`;
  }

  return {
    pesquisarFundamentos,
    consultaRapida,

    /** Bloco para o prompt de quem redige ('' quando não há nada conferido). */
    async fundamentosParaPeca(texto: string, ctx: ContextoPeca, quem: string): Promise<string> {
      const lista = await pesquisarFundamentos(texto, ctx);
      if (!lista.length) return '';
      registrar('pesquisador', `separou ${lista.length} fundamento(s) conferido(s) no acervo de leis para ${quem}`);
      return blocoFundamentos(lista);
    },

    /** Conferência da peça: situação de cada citação e, com IA, se o texto oficial sustenta a afirmação. */
    async conferirPeca(texto: string) {
      const itens: ItemConferido[] = acervo ? acervo.conferir(texto) : [];
      const conferiveis = itens.filter((x) => x.situacao === 'confere' && x.texto).slice(0, 15);
      if (conferiveis.length) {
        const lista = conferiveis.map((x, i) => `[${i}] CITAÇÃO: ${x.trecho}\nO QUE A PEÇA DIZ: ${contextoDaCitacao(texto, x.trecho)}\nTEXTO OFICIAL (${x.citacao}): ${trechoRelevante(String(x.texto), x.detalhe, 1800).replace(/\s+/g, ' ')}`).join('\n\n');
        try {
          const r = await ia(`Você é verificador(a) de citações de um escritório de advocacia. Para cada item, compare o que a peça afirma com o TEXTO OFICIAL do dispositivo e diga se o texto oficial sustenta a afirmação.
Responda APENAS com JSON: [{"i": 0, "sustenta": "sim" | "parcial" | "nao", "observacao": "uma frase curta quando não for sim"}]

${lista}`);
          const j = r.ok ? lerJsonDaIa(r.text || '') : null;
          if (Array.isArray(j)) {
            for (const v of j) {
              const alvo = conferiveis[Number(v?.i)];
              const s = String(v?.sustenta || '').toLowerCase().replace('ã', 'a');
              if (alvo && ['sim', 'parcial', 'nao'].includes(s)) {
                alvo.sustenta = s as any;
                if (v.observacao && s !== 'sim') alvo.observacao = String(v.observacao).slice(0, 300);
              }
            }
          }
        } catch { /* sem IA: vale a conferência por regra */ }
      }
      const confere = itens.filter((x) => x.situacao === 'confere').length;
      const contagem = { total: itens.length, confere, problemas: itens.length - confere, sentido: itens.filter((x) => x.sustenta === 'nao' || x.sustenta === 'parcial').length };
      if (itens.length) registrar('verificador', `conferiu ${itens.length} citação(ões): ${confere} conferem${contagem.problemas ? `, ${contagem.problemas} com problema` : ''}${contagem.sentido ? `, ${contagem.sentido} a rever o sentido` : ''}`);
      return { itens, contagem, relatorio: relatorioConferencia(itens) };
    },
  };
}
