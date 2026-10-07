/**
 * Briefing da véspera da audiência trabalhista (07/10/2026) — regras puras.
 *
 * Pedido da Dra. Letícia: 1 dia antes de cada audiência trabalhista, um
 * briefing conciso pelo WhatsApp com fatos centrais, pedidos, provas e
 * documentos-chave, perguntas (reclamante e testemunhas), riscos, pontos
 * controvertidos e providências pendentes — usando APENAS as fontes do caso
 * (petição inicial, contestação, documentos anexados, movimentações) e
 * destacando o que precisa de confirmação.
 */

/** Justiça do Trabalho = segmento "5" no número CNJ (NNNNNNN-DD.AAAA.5.TT.OOOO). */
export function ehAudienciaTrabalhista(c: { legal_area?: string | null; case_number?: string | null }): boolean {
  if (c.legal_area === 'trabalhista') return true;
  const d = String(c.case_number || '').replace(/\D/g, '');
  return d.length === 20 && d[13] === '5';
}

export interface DocCaso { id: number; name: string; mime: string; bytes: number }

const PRIORIDADE: [RegExp, number][] = [
  [/inicial|reclama[cç][aã]o trabalhista/i, 1],
  [/contesta[cç][aã]o|defesa/i, 2],
  [/autos|processo completo|íntegra|integra/i, 3],
  [/ata|audi[eê]ncia|senten[cç]a|decis[aã]o|despacho|r[eé]plica|impugna/i, 4],
  [/ctps|ponto|holerite|contracheque|rescis|trct|laudo|pericia|perícia|atestado|conversa|print|whatsapp/i, 5],
];
const prioridade = (nome: string) => PRIORIDADE.find(([re]) => re.test(nome))?.[1] ?? 9;
const LEGIVEL = /^(application\/pdf|image\/(jpeg|png|webp))$/;
const DOC_PESSOAL = /resid[eê]ncia|RG|CPF|CNH|identidade/i;

/**
 * Escolhe os documentos do caso que a IA vai ler: só PDF/imagem, os mais
 * importantes primeiro (inicial, contestação, autos, atas…), até o limite de
 * bytes do envio. Comprovante de residência e afins ficam por último.
 */
export function selecionarDocumentos(docs: DocCaso[], limiteBytes: number) {
  const ordenados = [...docs]
    .filter((d) => LEGIVEL.test(d.mime) && d.bytes > 0)
    .sort((a, b) => prioridade(a.name) - prioridade(b.name) || a.id - b.id)
    .filter((d) => !(prioridade(d.name) === 9 && DOC_PESSOAL.test(d.name))); // documento pessoal não ajuda na audiência
  const escolhidos: DocCaso[] = [];
  let total = 0;
  for (const d of ordenados) {
    if (total + d.bytes > limiteBytes) continue;
    escolhidos.push(d); total += d.bytes;
  }
  const ids = new Set(escolhidos.map((d) => d.id));
  return { escolhidos, deFora: docs.filter((d) => !ids.has(d.id)) };
}

export function montarInstrucao(o: { cliente: string; processo: string; quando: string; polo: 'ativo' | 'passivo' | string; contexto: string }): string {
  const defesa = o.polo === 'passivo';
  const lado = defesa ? 'a RECLAMADA (defesa)' : 'a RECLAMANTE (autora)';
  return `Você vai preparar o BRIEFING da audiência trabalhista de amanhã para a advogada, que representa ${lado}.
Cliente: ${o.cliente}. Processo: ${o.processo}. Audiência: ${o.quando}.

REGRAS:
- Use APENAS as fontes deste caso: os documentos anexados a esta mensagem e o texto "FONTES DO CASO" abaixo. Não use conhecimento externo sobre o caso e não invente fatos, valores, datas, nomes ou provas.
- Quando citar algo, diga de onde veio entre parênteses, ex.: (inicial), (contestação), (ata 14/05), (movimentação 20/09).
- Tudo que não estiver claro nas fontes, que for divergente entre elas ou que dependa de checagem antes da audiência, marque com "⚠️ CONFIRMAR:".
- Se uma fonte importante não estiver disponível (ex.: contestação ainda não juntada ou não anexada ao CRM), diga isso em PROVIDÊNCIAS PENDENTES.
- Seja conciso e prático: tópicos curtos, linguagem direta, nada de introdução. Texto para WhatsApp: use *negrito* só nos títulos, sem tabelas.

FORMATO (exatamente estas seções, nesta ordem):
*1. FATOS CENTRAIS* — o essencial do caso em até 6 tópicos.
*2. PEDIDOS* — o que se pede (e, se constar, o valor de cada pedido).
*3. PROVAS E DOCUMENTOS-CHAVE* — o que sustenta e o que enfraquece cada lado.
*4. PERGUNTAS* — ${defesa ? 'perguntas para o preposto da RECLAMADA (preparação), para a reclamante (parte contrária) e para as testemunhas' : 'perguntas para preparar a reclamante (depoimento pessoal), para o preposto da reclamada e para as testemunhas'}.
*5. RISCOS* — onde o caso pode perder ou reduzir valor.
*6. PONTOS CONTROVERTIDOS* — o que está em disputa e precisa ser provado.
*7. PROVIDÊNCIAS PENDENTES* — o que fazer ou confirmar até a audiência (testemunhas confirmadas, documentos, cálculos, link/endereço, proposta de acordo).

FONTES DO CASO (dados do CRM e movimentações):
${o.contexto}`;
}

/** Divide o texto para o WhatsApp em partes de até `max` caracteres, quebrando só entre linhas. */
export function dividirMensagem(texto: string, max = 3500): string[] {
  const linhas = String(texto).split('\n');
  const partes: string[] = [];
  let atual = '';
  for (const l of linhas) {
    if ((atual + '\n' + l).length > max && atual) { partes.push(atual + '\n(continua)'); atual = l; }
    else atual = atual ? `${atual}\n${l}` : l;
  }
  if (atual) partes.push(atual);
  return partes;
}

/** Amanhã inteiro no horário de Brasília (UTC−3), como intervalo em UTC [inicio, fim). */
export function janelaDeAmanha(agora: Date): { inicio: Date; fim: Date } {
  const hojeBrt = new Date(agora.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
  const inicio = new Date(Date.parse(hojeBrt + 'T00:00:00Z') + 24 * 3600_000 + 3 * 3600_000);
  return { inicio, fim: new Date(inicio.getTime() + 24 * 3600_000) };
}
