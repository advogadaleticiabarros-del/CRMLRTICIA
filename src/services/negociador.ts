/**
 * Dr. Rafael, negociação: responde às objeções do possível cliente depois que
 * a proposta aprovada pela Dra. foi enviada ("tá caro", "vou pensar", "quanto
 * tempo demora", "vou ganhar?"…), no tom da Dra. e dentro da ética da OAB:
 *  - Código de Ética e Disciplina (Res. CFOAB 02/2015): art. 9º (informar os
 *    riscos de forma clara), art. 7º (sem captação), art. 48 §6º (piso da
 *    tabela da OAB/ES — por isso desconto é só com a Dra.);
 *  - Provimento CFOAB 205/2021: sem promessa de resultado, sem expressões
 *    persuasivas, sem urgência ou escassez falsas, sem gratuidade como isca.
 * Modo rascunho (fila da Dra. Lívia). Regras puras — tests/negociadorAnalista.test.mjs.
 */

const semAcento = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const CATEGORIAS_OBJECAO = [
  'preco', 'pensar', 'consultar_alguem', 'prazo', 'garantia', 'confianca', 'outro_advogado', 'medo_empresa', 'custo_se_perder',
] as const;
export type CategoriaObjecao = typeof CATEGORIAS_OBJECAO[number];

const PADROES: Record<CategoriaObjecao, RegExp> = {
  preco: /\bcar[oa]\b|muito dinheiro|nao tenho (dinheiro|condic|como pagar)|sem condic|desconto|mais barat|nao (cabe|consigo pagar)|apertad|valor (alto|salgado)|pesado pra mim/,
  pensar: /vou pensar|pensar melhor|depois (eu )?(vejo|falo|te falo|respondo|te respondo)|\bvou ver\b|mais pra frente|outra hora|ainda nao sei|nao sei se vou/,
  consultar_alguem: /(falar|conversar|ver|consultar) com (o |a )?(meu|minha) (marido|esposa|mulher|familia|mae|pai|filh|namorad|companheir|irma)/,
  prazo: /quanto tempo|demora|demorar|quando (eu )?(vou )?receb|vai ser rapido|leva quanto|prazo pra (sair|terminar|acabar|receber)/,
  garantia: /vou ganhar|tenho chance|tem chance|e se (eu )?perder|garant|tem certeza|certeza (que|de)|da certo\?|vale a pena/,
  confianca: /golpe|confiavel|nunca (te )?vi|nao (te )?conheco|e seguro|enganad|como (eu )?sei que/,
  outro_advogado: /outr[oa] advogad|sindicato|defensoria|advogad[oa] (de graca|gratuit)|cobra(m|ram|ou)? menos|ja tenho advogad|de graca/,
  medo_empresa: /represalia|ainda trabalho|vao me (prejudicar|perseguir|mandar embora)|lista (negra|suja)|nunca mais (arrumo|consigo) emprego|medo da empresa/,
  custo_se_perder: /se (eu )?perder.{0,25}(pag|cust)|custas|sucumb|vou ter que pagar (algo|alguma coisa|a empresa)|pagar a empresa/,
};

/** Objeções presentes na mensagem do possível cliente (vazio = não é objeção). */
export function detectarObjecoes(texto: string): CategoriaObjecao[] {
  const t = semAcento(texto);
  return CATEGORIAS_OBJECAO.filter((c) => PADROES[c].test(t));
}

/** O texto padrão sobre a duração do processo (a Dra. pediu que seja sempre dito assim). */
export const MARCHA_PROCESSUAL =
  'O processo segue a marcha processual da Justiça: entrada da ação, citação ou notificação da outra parte, audiência, provas (às vezes perícia), ' +
  'sentença e, se alguém recorrer, os recursos. Cada etapa depende da pauta da Vara e dos prazos das partes. Por isso, com honestidade: ' +
  'o processo tem dia para começar, mas não tem dia para terminar. O que o escritório assume é acompanhar de perto e avisar a cada movimentação.';

export const REGRAS_ETICAS: string[] = [
  'Nunca prometa resultado nem diga que a pessoa "vai ganhar" ou "tem direito garantido" (Código de Ética da OAB e Provimento 205/2021).',
  'Nunca prometa prazo ("em 6 meses", "sai rápido", "não demora"): explique a marcha processual.',
  'Informe que todo processo tem riscos e que a Dra. explica com clareza os riscos e as consequências do caso (CED, art. 9º).',
  'Não ofereça desconto nem condição nova: só a Dra. muda valores, e o piso é a tabela da OAB/ES (CED, art. 48, §6º). Se pedirem, diga que vai levar à Dra.',
  'Repita somente os valores e condições da proposta aprovada; não invente outros.',
  'Sem pressão: nada de "só hoje", "últimas vagas", promoção ou urgência falsa (Provimento 205/2021). Prazo real (ex.: prescrição) só a Dra. comunica.',
  'Não fale mal de colegas, do sindicato ou da Defensoria: respeite a escolha e mostre como o escritório trabalha.',
  'Não use gratuidade como isca. Justiça gratuita só se a Dra. confirmar no caso.',
  'Não dê opinião jurídica sobre o caso concreto: informação geral pode; a análise do caso é da Dra.',
  'Respeite o "não": se a pessoa decidir não contratar, agradeça, deixe a porta aberta e encerre sem insistir.',
];

export const GUIA_OBJECOES: Record<CategoriaObjecao, { rotulo: string; porTras: string; comoResponder: string; nunca: string }> = {
  preco: {
    rotulo: 'Preço ("tá caro", "não tenho condições")',
    porTras: 'Ainda não ficou claro o que está incluído, ou o orçamento do mês está apertado.',
    comoResponder: 'Acolha. Pergunte se o ponto é o valor total ou a parcela do mês. Reforce o que a proposta inclui (todas as etapas até a sentença, acompanhamento e avisos) e as condições já aprovadas (entrada, parcelas, êxito só no final). Se a pessoa pedir outra condição, diga que vai levar o pedido à Dra.',
    nunca: 'Dar desconto, dizer "faço por menos" ou comparar com preço de outro advogado.',
  },
  pensar: {
    rotulo: '"Vou pensar"',
    porTras: 'Ficou alguma dúvida que a pessoa não disse.',
    comoResponder: 'Respeite o tempo dela. Pergunte com leveza se ficou alguma dúvida sobre a proposta, o processo ou os documentos e se ofereça para esclarecer. Proponha um próximo passo concreto (tirar a dúvida por áudio, conversar com a Dra.).',
    nunca: 'Pressionar ("a condição acaba hoje") ou mandar várias mensagens seguidas.',
  },
  consultar_alguem: {
    rotulo: '"Preciso falar com meu marido/esposa/família"',
    porTras: 'A decisão é da família, ou a pessoa quer apoio.',
    comoResponder: 'Valide (é uma decisão importante). Ofereça um resumo simples da proposta para mostrar em casa e se coloque à disposição para tirar as dúvidas da família também.',
    nunca: 'Desmerecer a opinião da família ou apressar.',
  },
  prazo: {
    rotulo: 'Prazo ("quanto tempo demora", "quando recebo")',
    porTras: 'Ansiedade e necessidade financeira.',
    comoResponder: 'Explique a marcha processual com o texto padrão: o processo tem dia para começar, mas não tem dia para terminar. Diga que o escritório acompanha cada movimentação e avisa a pessoa. Se perguntarem uma estimativa do caso dela, diga que a Dra. explica.',
    nunca: 'Dar prazo ("em 6 meses", "até o fim do ano", "sai rápido").',
  },
  garantia: {
    rotulo: 'Garantia ("vou ganhar?", "tenho chance?")',
    porTras: 'Medo de gastar e não ter retorno.',
    comoResponder: 'Seja honesto: nenhum advogado sério pode garantir resultado, porque quem decide é o juiz. Diga que a Dra. estuda o caso, explica com clareza as chances e os riscos antes de entrar, e que o êxito só é cobrado se houver ganho (quando a proposta prevê).',
    nunca: 'Dizer "vai ganhar", "causa ganha", "100%" ou "sem risco".',
  },
  confianca: {
    rotulo: 'Confiança ("é golpe?", "nunca te vi")',
    porTras: 'Medo de fraude, comum no atendimento on-line.',
    comoResponder: 'Acolha a cautela, que é saudável. Informe os dados verificáveis: a Dra. Letícia Elias Barros, OAB/ES 39.948 (dá para conferir no Cadastro Nacional dos Advogados, no site da OAB), o contrato escrito e assinado, os pagamentos só nas contas do escritório e o número do processo para a pessoa acompanhar. Ofereça uma chamada de vídeo com a Dra.',
    nunca: 'Ficar ofendido ou pedir pagamento antes do contrato.',
  },
  outro_advogado: {
    rotulo: 'Outro advogado, sindicato ou Defensoria',
    porTras: 'A pessoa está comparando opções.',
    comoResponder: 'Respeite: é direito dela escolher. Sem comparar, explique como o escritório trabalha (atendimento próximo, acompanhamento e avisos, a Dra. cuidando do caso) e deixe a porta aberta.',
    nunca: 'Falar mal do colega, do sindicato ou da Defensoria.',
  },
  medo_empresa: {
    rotulo: 'Medo da empresa (represália, "ainda trabalho lá")',
    porTras: 'Medo de perder o emprego ou de ficar "marcada".',
    comoResponder: 'Acolha o medo. Informe, em termos gerais, que entrar na Justiça é um direito garantido pela Constituição e que a Dra. explica como proteger a pessoa no caso dela, inclusive sobre o melhor momento de entrar.',
    nunca: 'Garantir que "não vai acontecer nada" ou incentivar a pessoa a sair do emprego.',
  },
  custo_se_perder: {
    rotulo: 'Custo se perder (custas, sucumbência)',
    porTras: 'Medo de sair devendo.',
    comoResponder: 'Diga que é uma ótima pergunta e que a Dra. explica com clareza, antes de entrar, os riscos e custos do caso (inclusive custas e honorários da outra parte) e se cabe justiça gratuita. Encaminhe para a Dra.',
    nunca: 'Dizer que "não tem risco nenhum" ou prometer justiça gratuita.',
  },
};

const brl = (n: number) => `R$ ${Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface PropostaNegociacao {
  id: number; nome: string; area: string | null; total: number; entrada: number; parcelas: number; valorParcela: number; exito: number | null; validade: string | null;
}

export function montarPromptNegociador(d: { guia: string; correcoes: string[]; objecoes: CategoriaObjecao[]; proposta: PropostaNegociacao; conversa: string[] }): string {
  const p = d.proposta;
  const condicoes = [
    p.total ? `Honorários iniciais: ${brl(p.total)}${p.entrada ? `, entrada de ${brl(p.entrada)}` : ''}${p.parcelas > 1 || (p.parcelas === 1 && p.entrada) ? ` e ${p.parcelas}x de ${brl(p.valorParcela)}` : ''}.` : 'Sem honorários iniciais.',
    p.exito ? `Êxito: ${p.exito}% sobre o que o cliente receber, só se houver ganho.` : '',
    p.validade ? `Validade da proposta: ${p.validade.split('-').reverse().join('/')}.` : '',
  ].filter(Boolean).join('\n');
  const guias = d.objecoes.map((c) => {
    const g = GUIA_OBJECOES[c];
    return `• ${g.rotulo}\n  O que costuma estar por trás: ${g.porTras}\n  Como responder: ${g.comoResponder}\n  Nunca: ${g.nunca}`;
  }).join('\n');
  return `Você é o Dr. Rafael, da equipe de atendimento do escritório da Dra. Letícia Barros (advocacia, Vitória/ES), no WhatsApp.
O possível cliente recebeu a proposta nº ${p.id} (aprovada pela Dra.) e respondeu com objeções. Escreva a PRÓXIMA mensagem do escritório, no tom de voz abaixo, para esclarecer com honestidade — sem vender a qualquer custo.

${d.guia || 'Tom: acolhedor, próximo, linguagem simples, mensagens curtas.'}

${d.correcoes.length ? `CORREÇÕES QUE A DRA. JÁ FEZ (siga sempre):\n${d.correcoes.map((x) => `- ${x}`).join('\n')}\n` : ''}
QUEM: ${p.nome}${p.area ? ` (área ${p.area})` : ''}.
PROPOSTA APROVADA (repita só estes valores, nunca outros):
${condicoes}

OBJEÇÕES IDENTIFICADAS E COMO TRATAR:
${guias || '• (nenhuma clara: pergunte com leveza se ficou alguma dúvida)'}

SOBRE A DURAÇÃO DO PROCESSO (use este conteúdo quando falarem de tempo):
${MARCHA_PROCESSUAL}

MÉTODO: 1) acolha o sentimento; 2) se precisar, faça UMA pergunta para entender o que está por trás; 3) esclareça com os fatos da proposta; 4) proponha um próximo passo concreto, sem pressão.

REGRAS (obrigatórias — ética da OAB):
${REGRAS_ETICAS.map((r) => `- ${r}`).join('\n')}
- Uma mensagem curta, sem juridiquês, no tom da Dra. Não invente nada que não esteja na conversa ou na proposta.

CONVERSA (mais recentes por último):
${d.conversa.join('\n').slice(-8000)}

Responda SOMENTE com JSON:
{"resposta":"texto da mensagem","objecoes":["${CATEGORIAS_OBJECAO.join('"|"')}"],"pedido_desconto":true|false,
 "precisa_dra":true|false,"motivo_dra":"por que a Dra. precisa ver (ou vazio)","temperatura":"quente"|"morna"|"fria"}`;
}

export interface RespostaNegociador {
  resposta: string; objecoes: CategoriaObjecao[]; pedido_desconto: boolean; precisa_dra: boolean; motivo_dra: string; temperatura: 'quente' | 'morna' | 'fria';
}

export function parseRespostaNegociador(texto: string): RespostaNegociador | null {
  const limpo = String(texto || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!limpo.startsWith('{')) return null;
  let o: any;
  try { o = JSON.parse(limpo); } catch { return null; }
  const resposta = typeof o?.resposta === 'string' ? o.resposta.trim() : '';
  if (!resposta) return null;
  const objecoes = (Array.isArray(o.objecoes) ? o.objecoes : []).filter((c: any) => (CATEGORIAS_OBJECAO as readonly string[]).includes(c));
  const pedido = o.pedido_desconto === true;
  return {
    resposta: resposta.slice(0, 1500), objecoes, pedido_desconto: pedido,
    // Pedido de desconto é decisão da Dra., sempre.
    precisa_dra: pedido || o.precisa_dra === true,
    motivo_dra: typeof o.motivo_dra === 'string' ? o.motivo_dra.trim().slice(0, 400) : '',
    temperatura: ['quente', 'morna', 'fria'].includes(o.temperatura) ? o.temperatura : 'morna',
  };
}

/** Valores que o Dr. Rafael pode citar: os da proposta aprovada. */
export function valoresDaProposta(parc: { total: number; entrada: number; parcelas: number }, exito: number | null) {
  const total = Number(parc.total) || 0, entrada = Number(parc.entrada) || 0, n = Math.max(1, Number(parc.parcelas) || 1);
  const parcela = Math.round(((total - entrada) / n) * 100) / 100;
  return { reais: [total, entrada, parcela].filter((x) => x > 0), percentuais: exito ? [Number(exito)] : [] };
}

const numBr = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

/** O que a Dra. precisa olhar antes de liberar a resposta do Dr. Rafael. */
export function alertasNegociador(resposta: string, permitidos: { reais: number[]; percentuais: number[] }): string[] {
  const t = semAcento(resposta);
  const out: string[] = [];
  if (/vai ganhar|garant(o|ido|ida|imos)|com certeza (vai|ganha)|causa ganha|100%|sem risco|nao tem como perder/.test(t)) out.push('promete resultado');
  if (/\bem (ate )?\d+ (dias|meses|semanas|anos)\b|(rapid[oa]|logo) (voce )?(recebe|sai|termina|resolve)|sai (rapido|logo)|nao demora|ate o (fim|final) do ano|resolve rapid/.test(t)) out.push('promete prazo');
  if (/desconto|abaixo do valor|faco por|deixo por|mais barat|abat(o|er|imento)/.test(t)) out.push('oferece desconto');
  if (/so (ate )?hoje|ultima(s)? vaga|promocao|vagas limitadas|corr[ae] que|aproveit[ae] (agora|ja)|oferta/.test(t)) out.push('pressão de venda');
  if (/(sindicato|defensoria|outr[oa]s? advogad[oa]s?).{0,40}(nao (presta|resolve|sabe|faz nada)|ruim|pessim|picaret|incompetent|enrola)/.test(t)) out.push('fala mal de colega');
  const fora = [...String(resposta).matchAll(/R\$\s*([\d.]+(?:,\d{1,2})?)/g)].map((m) => numBr(m[1]))
    .some((v) => !permitidos.reais.some((p) => Math.abs(p - v) < 0.5));
  const pctFora = [...String(resposta).matchAll(/(\d{1,3})\s?%/g)].map((m) => Number(m[1]))
    .some((v) => v !== 100 && !permitidos.percentuais.includes(v));
  if (fora || pctFora) out.push('valor fora da proposta');
  return out;
}

const ROTULO_CURTO: Record<CategoriaObjecao, string> = {
  preco: 'preço', pensar: '"vou pensar"', consultar_alguem: 'quer consultar a família', prazo: 'prazo', garantia: 'quer garantia',
  confianca: 'confiança', outro_advogado: 'outro advogado/sindicato', medo_empresa: 'medo da empresa', custo_se_perder: 'custo se perder',
};

/** Aviso à Dra.: pedido de desconto ou algo que só ela responde. */
export function mensagemDraObjecao(d: { id: number; nome: string; objecoes: CategoriaObjecao[]; trecho: string; pedidoDesconto: boolean; motivo: string }): string {
  return [
    `🤝 *Negociação — proposta nº ${d.id}* (${d.nome})`,
    `Objeção: ${d.objecoes.map((c) => ROTULO_CURTO[c]).join(', ') || 'não identificada'}`,
    `Cliente: "${String(d.trecho || '').replace(/\s+/g, ' ').slice(0, 300)}"`,
    d.pedidoDesconto ? '💲 Pediu *desconto ou outra condição*. Só a senhora decide.' : '',
    d.motivo ? `Por que a senhora precisa ver: ${d.motivo}` : '',
    '',
    `O Dr. Rafael deixou uma resposta pronta para aprovar no CRM (Escritório virtual → Dra. Lívia → Para aprovar).`,
    `Para mudar as condições: *ajustar ${d.id} total 1500, entrada 300, 4x* (e depois *aprovar ${d.id}*).`,
  ].filter((l) => l !== '').join('\n');
}
